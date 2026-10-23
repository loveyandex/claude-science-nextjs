"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, FileDown, FileText, Link2, Loader2, Play, ScanEye, Settings } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MakeSciencePanel, type MakeScienceStatus } from "@/components/doi/make-science-panel";
import { parseDoi } from "@/lib/doi";
import { formatBytes } from "@/lib/utils";

type StageState = "idle" | "running" | "done" | "failed" | "skipped";

type Added = {
  articleId: string;
  journalDbId: string;
  journalName: string;
  title: string;
  doi: string;
  openAccess: boolean;
  created: boolean;
};

export default function SpringerOneLinkPage() {
  const { authFetch } = useAuth();
  const [input, setInput] = useState("");
  const [providerUrl, setProviderUrl] = useState<string | null | undefined>(undefined);
  const [headless, setHeadless] = useStoredBool("springer:headless:details", false);
  const [fetchPdf, setFetchPdf] = useState(true);
  const [transcribe, setTranscribe] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [detailsState, setDetailsState] = useState<StageState>("idle");
  const [pdfState, setPdfState] = useState<StageState>("idle");
  const [scienceState, setScienceState] = useState<MakeScienceStatus>("idle");
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);

  const doi = parseDoi(input);

  useEffect(() => {
    authFetch("/api/settings/springer", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setProviderUrl(data.pdfProviderUrl ?? null))
      .catch(() => setProviderUrl(null));
  }, [authFetch]);

  const run = async () => {
    if (!doi) return;
    setRunning(true);
    setLog([]);
    setAdded(null);
    setPdfNote(null);
    setDetailsState("running");
    setPdfState(fetchPdf ? "idle" : "skipped");
    setScienceState(fetchPdf && transcribe ? "idle" : "skipped");
    const add = (line: string) => setLog((l) => [...l, line]);
    try {
      const res = await authFetch("/api/springer/one-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, headless, fetchPdf }),
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
          if (ev.type === "details_start") add(`Crawling ${ev.url}…`);
          if (ev.type === "journal_created") add(`+ Registered journal #${ev.journalId} — ${ev.name}`);
          if (ev.type === "details_done") {
            setDetailsState("done");
            add(
              `✓ ${ev.created ? "Added" : "Updated"}: ${ev.title}${
                ev.openAccess ? " (open access" + (ev.hasContent ? ", content saved)" : ")") : ""
              }`
            );
            setAdded({
              articleId: ev.articleId,
              journalDbId: ev.journalDbId,
              journalName: ev.journalName,
              title: ev.title,
              doi: ev.doi,
              openAccess: ev.openAccess,
              created: ev.created,
            });
          }
          if (ev.type === "pdf_start") {
            setPdfState("running");
            add(`Opening ${ev.url}…`);
          }
          if (ev.type === "pdf_skipped") {
            setPdfState("skipped");
            setPdfNote(ev.reason);
            add(`– PDF skipped: ${ev.reason}`);
          }
          if (ev.type === "challenge")
            add(`⏳ Browser check / CAPTCHA — solve it in the opened browser window (waiting up to ${ev.timeoutSec}s)…`);
          if (ev.type === "downloaded") {
            setPdfState("done");
            setPdfNote(`${formatBytes(ev.size)} from ${ev.sourceUrl}`);
            add(`✓ ${ev.doi} — ${formatBytes(ev.size)} from ${ev.sourceUrl}`);
          }
          if (ev.type === "not_found") {
            setPdfState("failed");
            setPdfNote(`Not found. ${ev.message}`);
            add(`– ${ev.doi}: not found. ${ev.message}`);
          }
          if (ev.type === "error") {
            if (ev.stage === "details") setDetailsState("failed");
            else {
              setPdfState("failed");
              setPdfNote(ev.message);
            }
            add(`✗ ${ev.doi}: ${ev.message}`);
          }
        }
      }
    } catch (err) {
      setDetailsState((s) => (s === "running" ? "failed" : s));
      add(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href="/springer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent mb-3"
        >
          <ChevronLeft size={12} /> journals
        </Link>

        <div className="flex items-center gap-2 mb-1">
          <Link2 size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">Add one Springer article</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6">
          Paste one article link and it&apos;s added to the Springer articles table right away — no journal list
          crawl. Runs stage 2 (abstract / content), stage 3 (PDF from the content provider), then stage 4 (each
          PDF page as an image → vision model → markdown on ArticleByDOI). Its journal is registered
          automatically if it&apos;s new.
        </p>

        <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && doi && !running) run();
              }}
              disabled={running}
              placeholder="https://link.springer.com/article/10.1007/s10853-025-11876-5"
              className="flex-1 min-w-[240px] rounded-md border border-border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-accent"
            />
            <Button onClick={run} disabled={!doi || running} size="sm">
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Add article
            </Button>
          </div>
          <p className="font-mono text-[10.5px] text-muted-foreground mt-2 break-all">
            {input.trim()
              ? doi
                ? `doi: ${doi} → https://link.springer.com/article/${doi}`
                : "No DOI found in that input"
              : "Also accepts https://doi.org/10.1007/… or a bare DOI like 10.1007/s10853-025-11876-5"}
          </p>
          <div className="flex items-center gap-4 flex-wrap mt-3">
            <label
              className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground cursor-pointer"
              title={headless ? "Crawls the article page with no browser window" : "Opens a visible browser window you can watch"}
            >
              <Switch checked={headless} onCheckedChange={setHeadless} disabled={running} />
              {headless ? "headless" : "show browser"} (stage 2)
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={fetchPdf}
                disabled={running}
                onChange={(e) => {
                  setFetchPdf(e.target.checked);
                  if (!e.target.checked) setTranscribe(false);
                }}
                className="accent-[hsl(var(--accent))]"
              />
              also fetch PDF (stage 3)
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={transcribe}
                disabled={running || !fetchPdf}
                onChange={(e) => setTranscribe(e.target.checked)}
                className="accent-[hsl(var(--accent))]"
              />
              also transcribe pages (stage 4)
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <StageCard
            icon={<FileText size={14} className="text-accent" />}
            title="2. Crawl abstract / content"
            state={detailsState}
            note={added ? `${added.created ? "added to" : "updated in"} ${added.journalName}` : null}
          />
          <StageCard
            icon={<FileDown size={14} className="text-accent" />}
            title="3. Get PDF from content provider"
            state={pdfState}
            note={
              pdfNote ??
              (providerUrl === null && fetchPdf ? "No provider URL set — configure it in Settings → Springer" : null)
            }
            action={
              providerUrl === null && fetchPdf ? (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 font-mono text-[10.5px] text-accent hover:underline"
                >
                  <Settings size={11} /> Settings
                </Link>
              ) : null
            }
          />
          <StageCard
            icon={<ScanEye size={14} className="text-accent" />}
            title="4. Pages → markdown"
            state={!transcribe || !fetchPdf ? "skipped" : scienceState}
            note={
              !transcribe || !fetchPdf
                ? "Unchecked — enable stage 4 above"
                : "Each PDF page as an image → vision model → ArticleByDOI"
            }
          />
        </div>

        {log.length > 0 && (
          <div className="rounded-lg border border-border bg-sidebar p-3 mb-4 max-h-48 overflow-y-auto scrollbar-thin">
            {log.map((l, i) => (
              <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed break-all">
                {l}
              </p>
            ))}
          </div>
        )}

        {added && !running && (
          <Link
            href={`/springer/${added.journalDbId}/${added.articleId}`}
            className="block rounded-lg border border-border bg-card p-3.5 hover:border-accent transition-colors group"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono text-[10px] text-muted-foreground truncate">{added.doi}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {added.openAccess && <Badge variant="accent">open access</Badge>}
                {pdfState === "done" && <Badge variant="accent">pdf</Badge>}
                <Badge variant="solid">indexed</Badge>
              </div>
            </div>
            <h3 className="font-display font-semibold text-[13.5px] leading-snug group-hover:text-accent transition-colors">
              {added.title}
            </h3>
            <p className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground mt-2">
              open article <ArrowRight size={11} />
            </p>
          </Link>
        )}

        <div className="mt-4">
          <MakeSciencePanel
            key={added?.doi ?? doi ?? "waiting"}
            doi={added?.doi ?? doi}
            title="4. Render each PDF page as an image"
            autoStart={transcribe && pdfState === "done" && !running}
            skipped={!transcribe || !fetchPdf}
            onStatus={setScienceState}
          />
        </div>
      </div>
    </div>
  );
}

function StageCard({
  icon,
  title,
  state,
  note,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  state: StageState;
  note: string | null;
  action?: React.ReactNode;
}) {
  const label: Record<StageState, string> = {
    idle: "waiting",
    running: "running",
    done: "done",
    failed: "failed",
    skipped: "skipped",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="font-display font-semibold text-[13px] truncate">{title}</h2>
        </div>
        {state === "running" ? (
          <Loader2 size={13} className="animate-spin text-accent shrink-0" />
        ) : (
          <Badge variant={state === "done" ? "accent" : "default"}>{label[state]}</Badge>
        )}
      </div>
      {note && <p className="font-mono text-[10.5px] text-muted-foreground break-all">{note}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

// Same key as the journal page's stage 2 toggle, so the choice is shared.
function useStoredBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setValue(stored === "1");
    } catch {}
  }, [key]);
  const update = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {}
  };
  return [value, update];
}
