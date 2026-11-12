"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Play, ScanEye, Settings, Square } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useVisionProviders, VisionProviderFields } from "@/components/doi/vision-provider-fields";
import { errorLines, TranscribeLive } from "@/components/doi/transcribe-live";
import type { BackendProgress } from "@/lib/transcribe-progress";

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

type ActiveRun = {
  provider: string;
  model: string;
  startedAt: string;
  stopRequested: boolean;
  pagesDone: number[];
  progress: BackendProgress | null;
};

type Live = {
  progress: BackendProgress | null;
  startedAt: number | null;
  lastEventAt: number | null;
  stopping: boolean;
};

const IDLE_LIVE: Live = { progress: null, startedAt: null, lastEventAt: null, stopping: false };
const FOLLOW_POLL_MS = 2000;

export type MakeScienceStatus = "idle" | "running" | "done" | "failed" | "skipped";

/**
 * "Make science" for one downloaded DOI PDF: render each page to an image,
 * transcribe it with a vision model (e.g. gemma4:31b, gemini-2.5-flash) on a
 * chosen openai-compatible or Gemini provider, store the pages on ArticleByDOI, and pull
 * title + abstract from page 1. Shared by /doi and /springer/one-link.
 *
 * A run lives on the server, not in this component: if the page is
 * reloaded, the stream drops, or the stage-4 job is reading this PDF, the
 * panel follows that run by polling instead of offering to start another.
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
  const vision = useVisionProviders();
  const { providers, providerId, modelName } = vision;
  const [concurrency, setConcurrency] = useState(1);
  const [force, setForce] = useState(false);
  const [article, setArticle] = useState<DoiArticle | null | undefined>(undefined);
  // `running`: this panel's own stream is open. `following`: a run is going
  // on the server without one (reload, dropped stream, stage-4 job).
  const [running, setRunning] = useState(false);
  const [following, setFollowing] = useState<ActiveRun | null>(null);
  const [live, setLive] = useState<Live>(IDLE_LIVE);
  const [runError, setRunError] = useState<string | null>(null);
  const [pages, setPages] = useState<Set<number>>(new Set());
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const autoStartedFor = useRef<string | null>(null);
  const runningRef = useRef(false);
  runningRef.current = running;
  const busy = running || !!following;

  const loadArticle = () => {
    if (!doi) {
      setArticle(null);
      setPages(new Set());
      setPageCount(null);
      setFollowing(null);
      return;
    }
    authFetch(`/api/doi-articles?doi=${encodeURIComponent(doi)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const a: DoiArticle | null = data.article ?? null;
        const runInfo: ActiveRun | null = data.activeRun ?? null;
        setArticle(a);
        setPages(new Set([...(a?.pagesDone ?? []), ...(runInfo?.pagesDone ?? [])]));
        setPageCount(a?.pageCount ?? runInfo?.progress?.pageCount ?? null);
        if (runInfo && !runningRef.current) {
          setFollowing(runInfo);
          setLive((l) => ({
            progress: runInfo.progress ?? l.progress,
            startedAt: new Date(runInfo.startedAt).getTime(),
            lastEventAt: runInfo.progress ? runInfo.progress.updatedAt * 1000 : l.lastEventAt ?? Date.now(),
            stopping: runInfo.stopRequested,
          }));
        } else if (!runInfo) {
          setFollowing(null);
        }
      })
      .catch(() => setArticle(null));
  };

  useEffect(loadArticle, [authFetch, doi]);

  // While following a server-side run, poll until it's gone, then show the result.
  useEffect(() => {
    if (!following) return;
    const t = setInterval(loadArticle, FOLLOW_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!following, doi]);

  useEffect(() => {
    if (skipped) onStatus?.("skipped");
    else if (busy) onStatus?.("running");
    else if (article?.status === "indexed") onStatus?.("done");
    else if (article?.status === "failed") onStatus?.("failed");
    else if (article?.status === "partial") onStatus?.("done");
    else onStatus?.("idle");
  }, [skipped, busy, article?.status, onStatus]);

  const run = async () => {
    if (!doi || skipped) return;
    setRunning(true);
    runningRef.current = true;
    setLog([]);
    setRunError(null);
    setLive({ ...IDLE_LIVE, startedAt: Date.now(), lastEventAt: Date.now() });
    if (force) setPages(new Set());
    const add = (line: string) => setLog((l) => [...l, line]);
    let finished = false;
    let handOff = false;
    try {
      const res = await authFetch("/api/doi-articles/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doi, providerId, modelName, concurrency, force }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Someone else is already reading it — follow that run instead.
        if (res.status === 409) handOff = true;
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream from server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          // The run itself carries on server-side; only our view of it broke.
          handOff = true;
          throw new Error("Lost the live connection to the server — the run continues there; following it instead.");
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          setLive((l) => ({ ...l, lastEventAt: Date.now() }));
          if (ev.type === "start")
            add(
              `Reading with ${ev.model} on ${ev.provider}${
                ev.skipped ? ` — ${ev.skipped} page(s) already saved, skipping them` : ""
              }`
            );
          if (ev.type === "progress") {
            setLive((l) => ({ ...l, progress: ev.progress }));
            if (ev.progress.pageCount) setPageCount(ev.progress.pageCount);
          }
          if (ev.type === "stopping") setLive((l) => ({ ...l, stopping: true }));
          if (ev.type === "page_done") {
            setPages((s) => new Set(s).add(ev.page));
            if (ev.pageCount) setPageCount(ev.pageCount);
          }
          if (ev.type === "pages_finished") {
            setPageCount(ev.pageCount);
            add(
              `${ev.pageCount - ev.failedPages.length}/${ev.pageCount} pages transcribed${
                ev.failedPages.length ? `, ${ev.failedPages.length} failed` : ""
              }`
            );
          }
          if (ev.type === "metadata")
            add(`✓ Title${ev.from === "springer" ? " (from the Springer record)" : ""}: ${ev.title}`);
          if (ev.type === "done") {
            finished = true;
            add(`Done — status: ${ev.status ?? "not read"}`);
          }
        }
      }
      if (!finished) {
        handOff = true;
        throw new Error("The server closed the stream before the run finished — checking on it…");
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Make science failed");
    } finally {
      setRunning(false);
      runningRef.current = false;
      if (!handOff) setLive(IDLE_LIVE);
      loadArticle();
    }
  };

  const stop = async () => {
    if (!doi) return;
    setLive((l) => ({ ...l, stopping: true }));
    const res = await authFetch("/api/doi-articles/transcribe/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doi }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLive((l) => ({ ...l, stopping: false }));
      setRunError(data.error || `Couldn't stop (${res.status})`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, doi]);

  useEffect(() => {
    if (skipped || !autoStart || !doi) return;
    if (!article || !providerId || !modelName.trim() || busy) return;
    if (article.status === "indexed" && !force) return;
    if (autoStartedFor.current === doi) return;
    autoStartedFor.current = doi;
    void runRef.current();
  }, [autoStart, skipped, doi, article, providerId, modelName, busy, force]);

  const done = pages.size;
  const percent = pageCount ? (done / pageCount) * 100 : busy ? null : 0;
  const storedErrors = article?.error ? errorLines(article.error) : [];

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <ScanEye size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">{title}</h2>
        </div>
        {busy ? (
          <Badge variant="accent">{live.stopping ? "stopping" : "reading"}</Badge>
        ) : (
          article?.status && (
            <Badge variant={article.status === "indexed" ? "accent" : "default"}>{article.status}</Badge>
          )
        )}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground mb-3">
        Each PDF page is rendered as an image, sent to a vision model (e.g. gemma4:31b, gemini-2.5-flash) on an
        openai-compatible or Gemini provider, stored as markdown on ArticleByDOI, then title + abstract are taken
        from page 1. Chat tools read those pages. Requires the backend/ FastAPI service.
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
          <Settings size={12} /> Add an openai-compatible or Gemini provider (with a vision model) in Settings → AI
          Providers
        </Link>
      ) : (
        <>
          {following ? (
            <p className="font-mono text-[11px] text-muted-foreground mb-3">
              Already being read on the server with {following.model} on {following.provider} — following that run.
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <VisionProviderFields vision={vision} disabled={busy} idPrefix="doi" />
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                parallel pages
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={concurrency}
                  disabled={busy}
                  onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
                  className="w-12 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
                />
              </label>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {busy ? (
              <Button variant="ghost" size="sm" onClick={stop} disabled={live.stopping}>
                <Square size={12} />
                {live.stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <Button onClick={run} disabled={!article || !providerId || !modelName.trim()} size="sm">
                <Play size={13} />
                {article?.status === "partial" && !force ? "Resume make science" : "Make science"}
              </Button>
            )}
            {!busy && (
              <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="accent-[hsl(var(--accent))]"
                />
                redo all pages
              </label>
            )}
            {(busy || done > 0) && (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {busy && <Loader2 size={11} className="inline animate-spin mr-1" />}
                {done}
                {pageCount ? ` / ${pageCount}` : ""} pages
              </span>
            )}
          </div>
          {(busy || done > 0) && <Progress value={percent} className="mt-3" label="pages transcribed" />}
          {(busy || live.progress) && (
            <TranscribeLive
              progress={live.progress}
              pagesDone={pages}
              pageCount={pageCount}
              startedAt={live.startedAt}
              lastEventAt={live.lastEventAt}
              stopping={live.stopping}
              running={busy}
            />
          )}
        </>
      )}

      {runError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 mt-3">
          <p className="font-mono text-[10.5px] text-destructive break-words">{runError}</p>
        </div>
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

      {article && !busy && (article.title || storedErrors.length > 0) && (
        <div className="mt-3 space-y-1">
          {article.title && <p className="font-display font-semibold text-[13px] leading-snug">{article.title}</p>}
          {article.abstract && <p className="text-[12px] text-muted-foreground line-clamp-4">{article.abstract}</p>}
          {article.transcribeModel && (
            <p className="font-mono text-[10px] text-muted-foreground">
              transcribed with {article.transcribeModel}
              {article.transcribeProvider ? ` · ${article.transcribeProvider}` : ""}
            </p>
          )}
          {storedErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 mt-2 space-y-0.5">
              <p className="font-mono text-[10.5px] text-destructive font-semibold">Last run didn&apos;t finish cleanly</p>
              {storedErrors.map((l, i) => (
                <p key={i} className="font-mono text-[10.5px] text-destructive break-words whitespace-pre-wrap">
                  {l}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
