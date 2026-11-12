"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { FileDown, FileText, Loader2, Play, Settings, Square, Workflow } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/lib/utils";

export type StreamEvent = Record<string, unknown> & { type: string };
type AuthFetch = ReturnType<typeof useAuth>["authFetch"];

/** POSTs `body` and calls `onEvent` for each line of the route's NDJSON stream. */
export async function runNdjsonStream(
  authFetch: AuthFetch,
  url: string,
  body: Record<string, unknown>,
  onEvent: (ev: StreamEvent) => void
) {
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
      onEvent(JSON.parse(line));
    }
  }
}

// Per-browser preference; storage can be unavailable (private mode,
// blocked site data), in which case it just doesn't persist.
export function useStoredBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
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

export function HeadlessToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground cursor-pointer"
      title={checked ? "Crawls in the background, no browser window" : "Opens a visible browser window you can watch"}
    >
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      {checked ? "headless" : "show browser"}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  disabled,
  min = 1,
  max,
  width = "w-16",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  width?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.max(min, Math.floor(Number(e.target.value)) || min);
          onChange(max != null ? Math.min(max, n) : n);
        }}
        className={`${width} rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent`}
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[hsl(var(--accent))]"
      />
      {label}
    </label>
  );
}

export type StageStats = {
  pending: number;
  pdf: { downloaded: number; notFound: number; failed: number; untried: number };
};

type DetailsResult = { total: number; processed: number; remaining: number };
type PdfResult = { total: number; downloaded: number; notFound: number; remaining: number; stopped: boolean };

/**
 * Stages 2 (abstracts/content) and 3 (PDFs) of the Springer pipeline, run
 * over either a set of articles (`dois`, e.g. the last stage-1 run) or the
 * whole journal (`dois` null). Each run is a batch; "keep going" repeats
 * batches until the scope has nothing left, and "Run 2 → 3" does stage 2 to
 * completion and then stage 3.
 */
export function PipelineSteps({
  journalDbId,
  dois,
  stats,
  scope,
  scopeTitle = "Run steps 2 and 3 on",
  disabled,
  onBusyChange,
  onLog,
  onLogReset,
  onEvent,
  onBatchDone,
}: {
  journalDbId: string;
  dois: string[] | null;
  stats: StageStats | null;
  // Scope picker / description, rendered at the top of the run card.
  scope?: ReactNode;
  scopeTitle?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onLog: (line: string) => void;
  onLogReset: () => void;
  onEvent?: (stage: "details" | "pdfs", ev: StreamEvent) => void;
  onBatchDone: () => void;
}) {
  const { authFetch } = useAuth();
  const [running, setRunning] = useState<null | "details" | "pdfs" | "all">(null);
  const [detailBatch, setDetailBatch] = useState(15);
  const [pdfBatch, setPdfBatch] = useState(10);
  const [retryNotFound, setRetryNotFound] = useState(false);
  const [detailHeadless, setDetailHeadless] = useStoredBool("springer:headless:details", false);
  const [detailsKeepGoing, setDetailsKeepGoing] = useStoredBool("springer:keepGoing:details", false);
  const [pdfsKeepGoing, setPdfsKeepGoing] = useStoredBool("springer:keepGoing:pdfs", false);
  const [providerUrl, setProviderUrl] = useState<string | null | undefined>(undefined);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    authFetch("/api/settings/springer", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setProviderUrl(data.pdfProviderUrl ?? null))
      .catch(() => setProviderUrl(null));
  }, [authFetch]);

  const scopeBody = dois ? { dois } : {};
  const busy = running !== null;
  const locked = busy || !!disabled;
  const pdfTodo = stats ? stats.pdf.untried + stats.pdf.failed + (retryNotFound ? stats.pdf.notFound : 0) : null;

  const runDetailsBatch = async (): Promise<DetailsResult> => {
    const result: DetailsResult = { total: 0, processed: 0, remaining: 0 };
    await runNdjsonStream(
      authFetch,
      `/api/springer/journals/${journalDbId}/crawl-details`,
      { limit: detailBatch, headless: detailHeadless, ...scopeBody },
      (ev) => {
        onEvent?.("details", ev);
        if (ev.type === "batch_start") {
          result.total = ev.total as number;
          onLog(`Fetching ${ev.total} article pages…`);
        }
        if (ev.type === "start") onLog(`[${ev.index}/${ev.total}] ${ev.doi}`);
        if (ev.type === "success")
          onLog(`✓ ${ev.title}${ev.openAccess ? " (open access" + (ev.hasContent ? ", content saved)" : ")") : ""}`);
        if (ev.type === "error") onLog(`✗ ${ev.doi}: ${ev.message}`);
        if (ev.type === "done") {
          result.processed = ev.processed as number;
          result.remaining = ev.remaining as number;
          onLog(`Batch done — ${ev.processed} processed, ${ev.remaining} pending remain`);
        }
        if (ev.type === "fatal") onLog(`Fatal: ${ev.message}`);
      }
    );
    return result;
  };

  const runPdfBatch = async (): Promise<PdfResult> => {
    const result: PdfResult = { total: 0, downloaded: 0, notFound: 0, remaining: 0, stopped: false };
    await runNdjsonStream(
      authFetch,
      `/api/springer/journals/${journalDbId}/fetch-pdfs`,
      { limit: pdfBatch, retryNotFound, ...scopeBody },
      (ev) => {
        onEvent?.("pdfs", ev);
        if (ev.type === "batch_start") {
          result.total = ev.total as number;
          onLog(`Fetching ${ev.total} PDFs from ${ev.provider}…`);
        }
        if (ev.type === "start") onLog(`[${ev.index}/${ev.total}] ${ev.url}`);
        if (ev.type === "challenge")
          onLog(`⏳ Browser check / CAPTCHA — solve it in the opened browser window (waiting up to ${ev.timeoutSec}s)…`);
        if (ev.type === "downloaded") onLog(`✓ ${ev.doi} — ${formatBytes(ev.size as number)} from ${ev.sourceUrl}`);
        if (ev.type === "not_found") onLog(`– ${ev.doi}: not found. ${ev.message}`);
        if (ev.type === "error") onLog(`✗ ${ev.doi}: ${ev.message}`);
        if (ev.type === "stopped") {
          result.stopped = true;
          onLog(`Stopped: ${ev.reason}`);
        }
        if (ev.type === "done") {
          result.downloaded = ev.downloaded as number;
          result.notFound = ev.notFound as number;
          result.remaining = ev.remaining as number;
          onLog(
            `Batch done — ${ev.downloaded} downloaded, ${ev.notFound} not found, ${ev.failed} failed, ${ev.remaining} left to try`
          );
        }
      }
    );
    return result;
  };

  // Batches until the scope is empty. Also stops when a whole batch made no
  // progress (every article errored), so a broken connection doesn't keep
  // marking the rest of the queue as failed.
  const loopDetails = async (keepGoing: boolean) => {
    while (true) {
      const r = await runDetailsBatch();
      onBatchDone();
      if (!keepGoing || stopRef.current || r.total === 0 || r.remaining <= 0) return;
      if (r.processed === 0) {
        onLog("Stopping: the last batch had no successes.");
        return;
      }
    }
  };

  const loopPdfs = async (keepGoing: boolean) => {
    while (true) {
      const r = await runPdfBatch();
      onBatchDone();
      if (!keepGoing || stopRef.current || r.stopped || r.total === 0 || r.remaining <= 0) return;
      if (r.downloaded + r.notFound === 0) {
        onLog("Stopping: the provider answered nothing in the last batch.");
        return;
      }
    }
  };

  const run = async (which: "details" | "pdfs" | "all") => {
    stopRef.current = false;
    setStopRequested(false);
    setRunning(which);
    onBusyChange?.(true);
    onLogReset();
    try {
      if (which === "details") await loopDetails(detailsKeepGoing);
      if (which === "pdfs") await loopPdfs(pdfsKeepGoing);
      if (which === "all") {
        onLog("── Step 2: abstracts / content ──");
        await loopDetails(true);
        if (!stopRef.current && providerUrl) {
          onLog("── Step 3: PDFs ──");
          await loopPdfs(true);
        }
      }
      if (stopRef.current) onLog("Stopped by you.");
    } catch (err) {
      onLog(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(null);
      onBusyChange?.(false);
      onBatchDone();
    }
  };

  const stop = () => {
    stopRef.current = true;
    setStopRequested(true);
  };

  const stopButton = (
    <Button variant="ghost" size="sm" onClick={stop} disabled={stopRequested}>
      <Square size={12} />
      {stopRequested ? "Stopping after this batch…" : "Stop"}
    </Button>
  );

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Workflow size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">{scopeTitle}</h2>
        </div>
        {scope}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <Button
            onClick={() => run("all")}
            disabled={locked || !stats || (stats.pending === 0 && (pdfTodo ?? 0) === 0)}
            size="sm"
          >
            {running === "all" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run 2 → 3 until done
          </Button>
          {running === "all" && stopButton}
          {stats && (
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {stats.pending} need step 2 · {pdfTodo} need step 3
            </span>
          )}
        </div>
      </div>

      {/* Stage 2: crawl details */}
      <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">2. Crawl abstracts / content</h2>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-3">
          Visits each pending article&apos;s own page for its abstract, and for open-access articles, its full
          content.{stats ? ` ${stats.pending} pending in this scope.` : ""}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => run("details")} disabled={locked || stats?.pending === 0} size="sm">
            {running === "details" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Fetch next batch
          </Button>
          {running === "details" && detailsKeepGoing && stopButton}
          <NumberField label="batch size" value={detailBatch} onChange={setDetailBatch} max={50} width="w-14" disabled={busy} />
          <CheckboxField
            label="keep going until none left"
            checked={detailsKeepGoing}
            onChange={setDetailsKeepGoing}
            disabled={busy}
          />
          <HeadlessToggle checked={detailHeadless} onChange={setDetailHeadless} disabled={busy} />
        </div>
      </div>

      {/* Stage 3: PDFs from the content provider */}
      <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <FileDown size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">3. Get PDFs from content provider</h2>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-2 break-all">
          Opens {providerUrl ? `${providerUrl}/<doi>` : "<provider>/<doi>"} for each article, follows any redirects,
          and saves the PDF as &lt;doi&gt;.pdf.
        </p>
        {stats && (
          <p className="font-mono text-[10.5px] text-muted-foreground mb-3">
            {stats.pdf.downloaded} downloaded · {stats.pdf.notFound} not found · {stats.pdf.failed} failed ·{" "}
            {stats.pdf.untried} not tried
          </p>
        )}
        {providerUrl === null ? (
          <Link href="/settings" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline">
            <Settings size={12} /> Set the provider URL in Settings → Springer first
          </Link>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => run("pdfs")} disabled={locked || providerUrl === undefined || pdfTodo === 0} size="sm">
              {running === "pdfs" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Fetch next batch
            </Button>
            {running === "pdfs" && pdfsKeepGoing && stopButton}
            <NumberField label="batch size" value={pdfBatch} onChange={setPdfBatch} max={50} width="w-14" disabled={busy} />
            <CheckboxField
              label="keep going until none left"
              checked={pdfsKeepGoing}
              onChange={setPdfsKeepGoing}
              disabled={busy}
            />
            <CheckboxField label="retry not-found" checked={retryNotFound} onChange={setRetryNotFound} disabled={busy} />
          </div>
        )}
      </div>
    </>
  );
}

export function StatCard({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className={`font-display font-semibold text-[20px] ${accent ? "text-accent" : ""}`}>{value}</p>
      <p className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="rounded-lg border border-border bg-card px-3 py-3 hover:border-accent transition-colors">
        {body}
      </Link>
    );
  }
  return <div className="rounded-lg border border-border bg-card px-3 py-3">{body}</div>;
}

export function RunLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div ref={ref} className="rounded-lg border border-border bg-sidebar p-3 mb-6 max-h-48 overflow-y-auto scrollbar-thin">
      {lines.map((l, i) => (
        <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed">
          {l}
        </p>
      ))}
    </div>
  );
}
