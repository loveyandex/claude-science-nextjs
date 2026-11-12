"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeProgress, failedPagesOf, type BackendProgress, type PageActivity } from "@/lib/transcribe-progress";

// Past this with no news from the backend, say so — before it's an error.
const QUIET_WARN_SECONDS = 90;
// doi-transcribe.ts STALL_MS
const STALL_MINUTES = 15;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const CHIP: Record<PageActivity["state"] | "saved", string> = {
  saved: "bg-accent text-accent-foreground border-accent",
  done: "bg-accent text-accent-foreground border-accent",
  running: "border-accent text-accent animate-pulse",
  retrying: "border-warning text-warning bg-warning/10",
  failed: "border-destructive text-destructive bg-destructive/10",
  cancelled: "border-border text-muted-foreground line-through",
  queued: "border-border text-muted-foreground",
};

/**
 * Live view of a "make science" run: what it's doing this second (waiting
 * on the model, backing off after a 429…), one chip per page, and every
 * page that failed with its reason. Works with whatever the backend sent
 * so far — an older backend without progress still gets page chips.
 */
export function TranscribeLive({
  progress,
  pagesDone,
  pageCount,
  startedAt,
  lastEventAt,
  stopping,
  running,
}: {
  progress: BackendProgress | null;
  pagesDone: Iterable<number>;
  pageCount: number | null;
  startedAt: number | null; // ms
  lastEventAt: number | null; // ms — last sign of life from the run
  stopping?: boolean;
  running: boolean;
}) {
  const now = useNow(running);
  const saved = new Set(pagesDone);
  const total = progress?.pageCount ?? pageCount;
  const activity = new Map((progress?.pages ?? []).map((p) => [p.page, p]));
  // Once the backend has queued its pages, any page it isn't sending was
  // already saved by an earlier run.
  if (progress && (progress.phase === "transcribing" || progress.phase === "finished") && total) {
    for (let n = 1; n <= total; n++) if (!activity.has(n)) saved.add(n);
  }
  const failed = failedPagesOf(progress);
  const quietFor = running && lastEventAt ? (now - lastEventAt) / 1000 : 0;

  const line = stopping
    ? "Stopping — letting the pages already at the provider finish…"
    : progress
      ? describeProgress(progress, now / 1000)
      : running
        ? "Starting the backend run…"
        : null;

  return (
    <div className="mt-3 space-y-2">
      {running && line && (
        <div className="flex items-start gap-2 rounded-md bg-sidebar px-2.5 py-2">
          <Loader2 size={12} className="animate-spin text-accent mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-foreground break-words">{line}</p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
              {startedAt ? `running ${formatDuration((now - startedAt) / 1000)}` : ""}
              {lastEventAt ? ` · last update ${formatDuration(quietFor)} ago` : ""}
            </p>
          </div>
        </div>
      )}

      {quietFor > QUIET_WARN_SECONDS && !stopping && (
        <p className="flex items-start gap-1.5 font-mono text-[10.5px] text-warning">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          No news from the backend for {formatDuration(quietFor)}. A slow or rate-limited model can take a few minutes
          per page with retries; the run gives up by itself after {STALL_MINUTES} minutes without progress. You can
          also stop it.
        </p>
      )}

      {total != null && total > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const a = activity.get(n);
            const state = saved.has(n) ? "saved" : a?.state ?? (running ? "queued" : "queued");
            const title = saved.has(n)
              ? `page ${n}: saved`
              : a
                ? `page ${n}: ${a.state}${a.attempt ? ` (attempt ${a.attempt})` : ""}${a.error ? ` — ${a.error}` : ""}`
                : `page ${n}: not read yet`;
            return (
              <span
                key={n}
                title={title}
                className={cn(
                  "inline-flex h-5 min-w-[22px] items-center justify-center rounded border px-1 font-mono text-[9.5px]",
                  CHIP[state]
                )}
              >
                {n}
              </span>
            );
          })}
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 space-y-1">
          <p className="font-mono text-[10.5px] text-destructive font-semibold">
            {failed.length} page{failed.length === 1 ? "" : "s"} failed{running ? " so far" : ""}
          </p>
          {failed.map((p) => (
            <p key={p.page} className="font-mono text-[10.5px] text-destructive break-words">
              page {p.page}: {p.error ?? "failed"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Splits a stored ArticleByDOI.error into readable lines (one per failed page). */
export function errorLines(error: string): string[] {
  return error
    .split(" · ")
    .flatMap((part) => {
      const m = part.match(/^(\d+ page\(s\) failed): ([\s\S]*)$/);
      if (!m) return [part];
      return [m[1], ...m[2].split(/; (?=page \d+ \()/).map((p) => `  ${p}`)];
    })
    .map((l) => l.trim() && l)
    .filter(Boolean);
}
