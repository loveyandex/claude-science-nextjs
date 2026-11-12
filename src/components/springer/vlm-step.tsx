"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Play, ScanEye, Settings, Square } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useVisionProviders, VisionProviderFields } from "@/components/doi/vision-provider-fields";
import { TranscribeLive } from "@/components/doi/transcribe-live";
import { NumberField } from "@/components/springer/pipeline-steps";
import type { VlmCounts, VlmJob } from "@/lib/springer-vlm";

const POLL_MS = 1500;

const isActive = (job: VlmJob | null) => job?.status === "running" || job?.status === "stopping";

export type VlmStepHandle = {
  /** Starts a job over just these articles with the card's current provider/model. */
  start: (dois: string[], scopeLabel: string) => Promise<void>;
};

/**
 * Stage 4: read downloaded PDFs page by page with a vision model, as a
 * server-side job (see src/lib/springer-vlm.ts) that this card starts,
 * stops, and polls. Independent of stages 2 and 3.
 */
export const VlmStep = forwardRef<
  VlmStepHandle,
  {
    journalDbId: string;
    dois: string[] | null;
    scopeLabel: string;
    counts: VlmCounts | null;
    onJob?: (job: VlmJob | null) => void;
    onFinished?: () => void;
  }
>(function VlmStep({ journalDbId, dois, scopeLabel, counts, onJob, onFinished }, ref) {
  const { authFetch } = useAuth();
  const vision = useVisionProviders();
  const { providers, providerId, modelName } = vision;
  const [concurrency, setConcurrency] = useState(1);
  const [retryFailed, setRetryFailed] = useState(true);
  const [job, setJob] = useState<VlmJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasActive = useRef(false);
  const callbacks = useRef({ onJob, onFinished });
  callbacks.current = { onJob, onFinished };

  const loadJob = () =>
    authFetch("/api/springer/vlm-job", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const next: VlmJob | null = data.job ?? null;
        setJob(next);
        callbacks.current.onJob?.(next);
        if (wasActive.current && !isActive(next)) callbacks.current.onFinished?.();
        wasActive.current = isActive(next);
      })
      .catch(() => {});

  useEffect(() => {
    void loadJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch]);

  const active = isActive(job);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void loadJob(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log.length]);

  const startJob = async (scopeDois: string[] | null, label: string, includeFailed = retryFailed) => {
    setStarting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/springer/journals/${journalDbId}/vlm-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          modelName,
          concurrency,
          retryFailed: includeFailed,
          scopeLabel: label,
          ...(scopeDois ? { dois: scopeDois } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      wasActive.current = true;
      setJob(data.job);
      callbacks.current.onJob?.(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the job");
    } finally {
      setStarting(false);
    }
  };

  // Picking one article by hand means "read it", whatever its last outcome.
  useImperativeHandle(ref, () => ({ start: (d, label) => startJob(d, label, true) }));

  const stop = async () => {
    const res = await authFetch("/api/springer/vlm-job/stop", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.job) setJob(data.job);
  };

  const toRead = counts ? counts.todo + counts.partial + (retryFailed ? counts.failed : 0) : null;
  const jobHere = job && job.journalDbId === journalDbId ? job : null;
  const busyElsewhere = active && job && job.journalDbId !== journalDbId;
  const canStart = !active && !starting && !!providerId && !!modelName.trim() && toRead !== 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3.5 mb-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <ScanEye size={14} className="text-accent" />
          <h2 className="font-display font-semibold text-[13px]">4. Read PDFs with a vision model</h2>
        </div>
        {jobHere && <JobBadge status={jobHere.status} />}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground mb-2">
        Renders each downloaded PDF&apos;s pages to images and transcribes every page with a vision model (e.g.
        gemma4:31b, gemini-2.5-flash) on an openai-compatible or Gemini provider, through the backend/ service. Runs as a server-side job — you can leave this page — and an
        article stopped halfway resumes from its first missing page. Independent of steps 2 and 3.
      </p>
      {counts && (
        <p className="font-mono text-[10.5px] text-muted-foreground mb-3">
          {scopeLabel}: {counts.downloaded} PDFs · {counts.done} fully read · {counts.partial} partial · {counts.failed}{" "}
          failed · {counts.todo} not read
        </p>
      )}

      {providers && providers.length === 0 ? (
        <Link href="/settings" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline">
          <Settings size={12} /> Add an openai-compatible or Gemini provider (with a vision model) in Settings → AI
          Providers
        </Link>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <VisionProviderFields vision={vision} disabled={active} idPrefix="vlm" />
            <NumberField label="parallel pages" value={concurrency} onChange={setConcurrency} max={8} width="w-12" disabled={active} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => startJob(dois, scopeLabel)} disabled={!canStart} size="sm">
              {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {toRead != null ? `Read ${toRead} PDF${toRead === 1 ? "" : "s"}` : "Start reading"}
            </Button>
            {active && (
              <Button variant="ghost" size="sm" onClick={stop} disabled={job?.status === "stopping"}>
                <Square size={12} />
                {job?.status === "stopping" ? "Stopping…" : "Stop job"}
              </Button>
            )}
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={retryFailed}
                disabled={active}
                onChange={(e) => setRetryFailed(e.target.checked)}
                className="accent-[hsl(var(--accent))]"
              />
              retry failed
            </label>
          </div>
        </>
      )}

      {error && <p className="font-mono text-[10.5px] text-destructive mt-2">{error}</p>}
      {busyElsewhere && (
        <p className="font-mono text-[10.5px] text-muted-foreground mt-2">
          A PDF-reading job is running for{" "}
          <Link href={`/springer/${job!.journalDbId}/pdfs`} className="text-accent hover:underline">
            {job!.journalName}
          </Link>{" "}
          — one job runs at a time.
        </p>
      )}

      {jobHere && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
            <span>
              {jobHere.processed}/{jobHere.total} articles · {jobHere.results.done} fully read · {jobHere.results.partial}{" "}
              partial · {jobHere.results.failed} failed
              {jobHere.results.skipped ? ` · ${jobHere.results.skipped} skipped` : ""}
            </span>
            <span>
              {jobHere.model} · {jobHere.provider}
            </span>
          </div>
          <Progress value={jobHere.total ? (jobHere.processed / jobHere.total) * 100 : 0} label="articles read" />
          {jobHere.current && (
            <div className="rounded-md bg-sidebar px-2.5 py-2">
              <p className="text-[12px] truncate">
                <Loader2 size={11} className="inline animate-spin mr-1.5 text-accent" />
                {jobHere.current.title}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <Progress
                  value={jobHere.current.pageCount ? (jobHere.current.pagesDone / jobHere.current.pageCount) * 100 : null}
                  className="flex-1"
                  label="pages read"
                />
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {jobHere.current.pagesDone}/{jobHere.current.pageCount ?? "?"} pages
                </span>
              </div>
              <TranscribeLive
                progress={jobHere.current.progress}
                pagesDone={[]}
                pageCount={jobHere.current.pageCount}
                startedAt={null}
                lastEventAt={jobHere.current.progress ? jobHere.current.progress.updatedAt * 1000 : null}
                stopping={jobHere.status === "stopping"}
                running={active}
              />
            </div>
          )}
          {jobHere.error && <p className="font-mono text-[10.5px] text-destructive">{jobHere.error}</p>}
          <div ref={logRef} className="rounded-md border border-border bg-sidebar p-2.5 max-h-44 overflow-y-auto scrollbar-thin">
            {jobHere.log.map((l, i) => (
              <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed break-all">
                {l}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function JobBadge({ status }: { status: VlmJob["status"] }) {
  const label: Record<VlmJob["status"], string> = {
    running: "running",
    stopping: "stopping",
    stopped: "stopped",
    done: "finished",
    failed: "gave up",
  };
  return <Badge variant={status === "running" || status === "stopping" ? "accent" : "default"}>{label[status]}</Badge>;
}
