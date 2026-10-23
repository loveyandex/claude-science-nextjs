"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Play, ScanEye, Settings } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type VisionProvider = { id: string; label: string; baseUrl: string | null; models: { modelName: string; label: string }[] };

type DoiArticle = {
  id: string;
  doi: string;
  title: string | null;
  abstract: string | null;
  pageCount: number | null;
  status: string | null;
  error: string | null;
  transcribeProvider: string | null;
  transcribeModel: string | null;
  pagesDone: number[];
};

const PROVIDER_KEY = "doi:makeScience:provider";
const MODEL_KEY = "doi:makeScience:model";

export type MakeScienceStatus = "idle" | "running" | "done" | "failed" | "skipped";

/**
 * "Make science" for one downloaded DOI PDF: render each page to an image,
 * transcribe it with a vision model (e.g. gemma4:31b) on a chosen
 * openai-compatible provider, store the pages on ArticleByDOI, and pull
 * title + abstract from page 1. Shared by /doi and /springer/one-link.
 */
export function MakeSciencePanel({
  doi,
  title = "Make science · gemma4",
  autoStart = false,
  skipped = false,
  onStatus,
}: {
  doi?: string | null;
  title?: string;
  autoStart?: boolean;
  skipped?: boolean;
  onStatus?: (state: MakeScienceStatus) => void;
}) {
  const { authFetch } = useAuth();
  const [providers, setProviders] = useState<VisionProvider[] | null>(null);
  const [providerId, setProviderId] = useState("");
  const [modelName, setModelName] = useState("");
  const [concurrency, setConcurrency] = useState(1);
  const [force, setForce] = useState(false);
  const [article, setArticle] = useState<DoiArticle | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [pages, setPages] = useState<Set<number>>(new Set());
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const autoStartedFor = useRef<string | null>(null);

  const loadArticle = () => {
    if (!doi) {
      setArticle(null);
      setPages(new Set());
      setPageCount(null);
      return;
    }
    authFetch(`/api/doi-articles?doi=${encodeURIComponent(doi)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const a: DoiArticle | null = data.article ?? null;
        setArticle(a);
        if (a) {
          setPages(new Set(a.pagesDone));
          setPageCount(a.pageCount);
        } else {
          setPages(new Set());
          setPageCount(null);
        }
      })
      .catch(() => setArticle(null));
  };

  useEffect(loadArticle, [authFetch, doi]);

  useEffect(() => {
    if (skipped) onStatus?.("skipped");
    else if (running) onStatus?.("running");
    else if (article?.status === "indexed") onStatus?.("done");
    else if (article?.status === "failed") onStatus?.("failed");
    else if (article?.status === "partial") onStatus?.("done");
    else onStatus?.("idle");
  }, [skipped, running, article?.status, onStatus]);

  useEffect(() => {
    authFetch("/api/doi-articles/vision-providers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const list: VisionProvider[] = data.providers ?? [];
        setProviders(list);
        let storedProvider = "";
        let storedModel = "";
        try {
          storedProvider = localStorage.getItem(PROVIDER_KEY) ?? "";
          storedModel = localStorage.getItem(MODEL_KEY) ?? "";
        } catch {}
        const provider = list.find((p) => p.id === storedProvider) ?? list[0];
        if (!provider) return;
        setProviderId(provider.id);
        setModelName(
          storedModel && provider.id === storedProvider
            ? storedModel
            : provider.models.find((m) => /gemma/i.test(m.modelName))?.modelName ?? provider.models[0]?.modelName ?? ""
        );
      })
      .catch(() => setProviders([]));
  }, [authFetch]);

  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  const provider = providers?.find((p) => p.id === providerId);

  const run = async () => {
    if (!doi || skipped) return;
    setRunning(true);
    setLog([]);
    if (force) setPages(new Set());
    const add = (line: string) => setLog((l) => [...l, line]);
    try {
      const res = await authFetch("/api/doi-articles/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doi, providerId, modelName, concurrency, force }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream from server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "start")
            add(
              `Rendering pages and transcribing with ${ev.model} on ${ev.provider}${
                ev.skipped ? ` — ${ev.skipped} page(s) already saved, skipping them` : ""
              }…`
            );
          if (ev.type === "page_done") {
            setPages((s) => new Set(s).add(ev.page));
            if (ev.pageCount) setPageCount(ev.pageCount);
          }
          if (ev.type === "pages_finished") {
            setPageCount(ev.pageCount);
            add(
              `✓ ${ev.pageCount - ev.failedPages.length}/${ev.pageCount} pages transcribed${
                ev.failedPages.length ? ` — failed: ${ev.failedPages.map((p: { page: number }) => p.page).join(", ")}` : ""
              }`
            );
          }
          if (ev.type === "metadata")
            add(`✓ Title${ev.from === "springer" ? " (from the Springer record)" : ""}: ${ev.title}`);
          if (ev.type === "error") add(`✗ ${ev.message}`);
          if (ev.type === "done") add(`Done — status: ${ev.status}`);
        }
      }
    } catch (err) {
      add(err instanceof Error ? err.message : "Make science failed");
    } finally {
      setRunning(false);
      loadArticle();
    }
  };

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!autoStart) autoStartedFor.current = null;
  }, [autoStart]);

  useEffect(() => {
    if (autoStart && doi) loadArticle();
  }, [autoStart, doi]);

  useEffect(() => {
    if (skipped || !autoStart || !doi) return;
    if (!article || !providerId || !modelName.trim() || running) return;
    if (article.status === "indexed" && !force) return;
    if (autoStartedFor.current === doi) return;
    autoStartedFor.current = doi;
    void runRef.current();
  }, [autoStart, skipped, doi, article, providerId, modelName, running, force]);

  const done = pages.size;
  const percent = pageCount ? (done / pageCount) * 100 : running ? null : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <ScanEye size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">{title}</h2>
        </div>
        {article?.status && (
          <Badge variant={article.status === "indexed" ? "accent" : "default"}>{article.status}</Badge>
        )}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground mb-3">
        Each PDF page is rendered as an image, sent to a vision model (e.g. gemma4:31b) on an openai-compatible
        provider, stored as markdown on ArticleByDOI, then title + abstract are taken from page 1. Chat tools
        read those pages. Requires the backend/ FastAPI service.
      </p>

      {skipped ? (
        <p className="font-mono text-[11px] text-muted-foreground">Skipped — enable this stage with the checkbox above.</p>
      ) : !doi ? (
        <p className="font-mono text-[11px] text-muted-foreground mb-3">Waiting for a DOI. Paste a link above.</p>
      ) : article === null ? (
        <p className="font-mono text-[11px] text-muted-foreground mb-3">
          No downloaded PDF for this DOI yet — stage 3 has to finish first.
        </p>
      ) : null}

      {skipped ? null : providers && providers.length === 0 ? (
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline"
        >
          <Settings size={12} /> Add an openai-compatible provider (with a vision model) in Settings → AI Providers
        </Link>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              provider
              <Select
                value={providerId}
                disabled={running || !providers}
                onValueChange={(v) => {
                  setProviderId(v);
                  remember(PROVIDER_KEY, v);
                  const next = providers?.find((p) => p.id === v);
                  const model =
                    next?.models.find((m) => /gemma/i.test(m.modelName))?.modelName ?? next?.models[0]?.modelName ?? "";
                  setModelName(model);
                  remember(MODEL_KEY, model);
                }}
              >
                <SelectTrigger className="border border-border text-foreground min-w-[140px] justify-between">
                  <SelectValue placeholder="loading…" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((p) => (
                    <SelectItem key={p.id} value={p.id} description={p.baseUrl ?? undefined}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              model
              <input
                list={`doi-models-${providerId}`}
                value={modelName}
                disabled={running}
                onChange={(e) => {
                  setModelName(e.target.value);
                  remember(MODEL_KEY, e.target.value);
                }}
                placeholder="gemma4:31b"
                className="w-44 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
              />
              <datalist id={`doi-models-${providerId}`}>
                {provider?.models.map((m) => (
                  <option key={m.modelName} value={m.modelName}>
                    {m.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              parallel pages
              <input
                type="number"
                min={1}
                max={8}
                value={concurrency}
                disabled={running}
                onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
                className="w-12 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
              />
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={run}
              disabled={running || !article || !providerId || !modelName.trim()}
              size="sm"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {article?.status === "partial" && !force ? "Resume make science" : "Make science"}
            </Button>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={force}
                disabled={running}
                onChange={(e) => setForce(e.target.checked)}
                className="accent-[hsl(var(--accent))]"
              />
              redo all pages
            </label>
            {(running || done > 0) && (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {done}
                {pageCount ? ` / ${pageCount}` : ""} pages
              </span>
            )}
          </div>
          {(running || done > 0) && <Progress value={percent} className="mt-3" label="pages transcribed" />}
        </>
      )}

      {log.length > 0 && (
        <div className="rounded-lg border border-border bg-sidebar p-3 mt-3 max-h-40 overflow-y-auto scrollbar-thin">
          {log.map((l, i) => (
            <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed break-all">
              {l}
            </p>
          ))}
        </div>
      )}

      {article && !running && (article.title || article.error) && (
        <div className="mt-3 space-y-1">
          {article.title && <p className="font-display font-semibold text-[13px] leading-snug">{article.title}</p>}
          {article.abstract && <p className="text-[12px] text-muted-foreground line-clamp-4">{article.abstract}</p>}
          {article.transcribeModel && (
            <p className="font-mono text-[10px] text-muted-foreground">
              transcribed with {article.transcribeModel}
              {article.transcribeProvider ? ` · ${article.transcribeProvider}` : ""}
            </p>
          )}
          {article.error && <p className="font-mono text-[10.5px] text-destructive break-words">{article.error}</p>}
        </div>
      )}
    </div>
  );
}
