import { prisma } from "@/lib/prisma";
import { ensureArticleByDoi } from "@/lib/article-by-doi";
import { transcribeDoiArticle, TranscriptionBusyError, type VisionProviderConfig } from "@/lib/doi-transcribe";
import { failedPagesOf, type BackendProgress } from "@/lib/transcribe-progress";

/*
 * Springer stage 4: read each downloaded PDF page by page with a vision
 * model ("make science"), as a server-side job — it keeps going with the
 * browser closed, and the page just polls it. The per-article state isn't
 * stored on SpringerArticle: it's derived from the ArticleByDOI row and its
 * saved pages (the same rows the single-article "Make science" panel
 * writes), so articles read before this step existed are counted correctly
 * and a run stopped halfway resumes from the first missing page.
 */

// done: every page saved · partial: some pages saved (stopped / page
// errors) · failed: tried, nothing saved · todo: never read
export type VlmState = "done" | "partial" | "failed" | "todo";

export type VlmInfo = {
  state: VlmState;
  status: string | null;
  pageCount: number | null;
  pagesDone: number;
  error: string | null;
  model: string | null;
};

export type VlmCounts = { downloaded: number; done: number; partial: number; failed: number; todo: number };

const TODO: VlmInfo = { state: "todo", status: null, pageCount: null, pagesDone: 0, error: null, model: null };

export function vlmStateOf(row: { status: string | null; pageCount: number | null; pagesDone: number }): VlmState {
  // Judged by the pages actually saved, not `status` alone: a run that
  // died before writing its final status can still have every page.
  if (row.pageCount != null && row.pageCount > 0 && row.pagesDone >= row.pageCount) return "done";
  if (row.pagesDone > 0) return "partial";
  if (row.status === "failed" || row.status === "partial") return "failed";
  return "todo";
}

export async function vlmInfoByDoi(dois: string[]): Promise<Map<string, VlmInfo>> {
  const map = new Map<string, VlmInfo>();
  if (dois.length === 0) return map;
  const rows = await prisma.articleByDOI.findMany({
    where: { doi: { in: dois } },
    select: {
      doi: true,
      status: true,
      pageCount: true,
      error: true,
      transcribeModel: true,
      _count: { select: { pages: true } },
    },
  });
  for (const r of rows) {
    const pagesDone = r._count.pages;
    map.set(r.doi, {
      state: vlmStateOf({ status: r.status, pageCount: r.pageCount, pagesDone }),
      status: r.status,
      pageCount: r.pageCount,
      pagesDone,
      error: r.error,
      model: r.transcribeModel,
    });
  }
  return map;
}

export function vlmInfoFor(map: Map<string, VlmInfo>, doi: string): VlmInfo {
  return map.get(doi) ?? TODO;
}

/** Stage-4 counts over a journal's downloaded PDFs, optionally limited to `dois`. */
export async function vlmCounts(journalDbId: string, dois?: string[]): Promise<VlmCounts> {
  const downloaded = await prisma.springerArticle.findMany({
    where: { journalId: journalDbId, pdfStatus: "downloaded", ...(dois ? { doi: { in: dois } } : {}) },
    select: { doi: true },
  });
  const infos = await vlmInfoByDoi(downloaded.map((d) => d.doi));
  const counts: VlmCounts = { downloaded: downloaded.length, done: 0, partial: 0, failed: 0, todo: 0 };
  for (const { doi } of downloaded) counts[vlmInfoFor(infos, doi).state]++;
  return counts;
}

// --- the job --------------------------------------------------------------

export type VlmJobStatus = "running" | "stopping" | "stopped" | "done" | "failed";

export type VlmJob = {
  id: string;
  journalDbId: string;
  journalName: string;
  scopeLabel: string;
  provider: string;
  model: string;
  concurrency: number;
  status: VlmJobStatus;
  total: number;
  processed: number;
  results: { done: number; partial: number; failed: number; skipped: number };
  current: {
    doi: string;
    articleId: string;
    title: string;
    pagesDone: number;
    pageCount: number | null;
    // The backend's live progress for this article (phase, each page's
    // attempts/retries/errors), so the page can say what it's waiting on.
    progress: BackendProgress | null;
  } | null;
  log: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const MAX_LOG_LINES = 200;
// Articles in a row that ended with nothing saved and an error — the
// backend or the provider is down, so stop instead of failing the queue.
const MAX_CONSECUTIVE_FAILURES = 3;

// On globalThis so every route bundle (and dev-mode reloads) share one job.
const store = globalThis as unknown as { __springerVlmJob?: { job: VlmJob; stop: boolean } };

export function getVlmJob(): VlmJob | null {
  return store.__springerVlmJob?.job ?? null;
}

export function stopVlmJob(): VlmJob | null {
  const entry = store.__springerVlmJob;
  if (!entry) return null;
  if (entry.job.status === "running") {
    entry.stop = true;
    entry.job.status = "stopping";
    log(entry.job, "Stop requested — finishing the pages already at the provider…");
  }
  return entry.job;
}

function log(job: VlmJob, line: string) {
  job.log.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

export type StartVlmJobInput = {
  journalDbId: string;
  provider: VisionProviderConfig;
  modelName: string;
  concurrency: number;
  dois?: string[];
  retryFailed: boolean;
  scopeLabel: string;
};

/**
 * Picks the journal's downloaded PDFs that aren't fully read (never read,
 * partial, and — if `retryFailed` — failed), oldest first, and reads them
 * one article at a time in the background. One job at a time app-wide,
 * since they'd all be sharing the same vision provider.
 */
export async function startVlmJob(input: StartVlmJobInput): Promise<{ job: VlmJob } | { error: string; status: number }> {
  const existing = store.__springerVlmJob?.job;
  if (existing && (existing.status === "running" || existing.status === "stopping")) {
    return { error: `A PDF-reading job is already running (${existing.journalName}) — stop it first.`, status: 409 };
  }

  const journal = await prisma.springerJournal.findUnique({ where: { id: input.journalDbId } });
  if (!journal) return { error: "Journal not found", status: 404 };

  const candidates = await prisma.springerArticle.findMany({
    where: {
      journalId: journal.id,
      pdfStatus: "downloaded",
      ...(input.dois ? { doi: { in: input.dois } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, doi: true, title: true },
  });
  const infos = await vlmInfoByDoi(candidates.map((c) => c.doi));
  const queue = candidates.filter((c) => {
    const state = vlmInfoFor(infos, c.doi).state;
    return state === "todo" || state === "partial" || (state === "failed" && input.retryFailed);
  });

  const job: VlmJob = {
    id: Math.random().toString(36).slice(2, 10),
    journalDbId: journal.id,
    journalName: journal.name,
    scopeLabel: input.scopeLabel,
    provider: input.provider.label,
    model: input.modelName,
    concurrency: input.concurrency,
    status: "running",
    total: queue.length,
    processed: 0,
    results: { done: 0, partial: 0, failed: 0, skipped: 0 },
    current: null,
    log: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const entry = { job, stop: false };
  store.__springerVlmJob = entry;
  log(
    job,
    `Reading ${queue.length} PDF(s) from ${input.scopeLabel} with ${input.modelName} on ${input.provider.label} (${
      candidates.length - queue.length
    } already read${input.retryFailed ? "" : " or failed"}, skipped)`
  );

  void runJob(entry, queue, input).catch((err) => {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.current = null;
    job.finishedAt = new Date().toISOString();
    log(job, `Job crashed: ${job.error}`);
  });
  return { job };
}

async function runJob(
  entry: { job: VlmJob; stop: boolean },
  queue: { id: string; doi: string; title: string }[],
  input: StartVlmJobInput
) {
  const { job } = entry;
  let consecutiveFailures = 0;

  for (const item of queue) {
    if (entry.stop) break;
    job.current = { doi: item.doi, articleId: item.id, title: item.title, pagesDone: 0, pageCount: null, progress: null };
    log(job, `[${job.processed + 1}/${job.total}] ${item.doi} — ${item.title}`);

    try {
      // Re-checked here, not just at start: the single-article panel (or
      // an earlier article's retry) may have finished this one meanwhile.
      const now = vlmInfoFor(await vlmInfoByDoi([item.doi]), item.doi);
      if (now.state === "done") {
        job.results.skipped++;
        log(job, "  already fully read, skipped");
        continue;
      }

      const article = await ensureArticleByDoi(item.doi);
      if (!article) {
        // Marked "failed" (not "not_found") so stage 3 downloads it again.
        await prisma.springerArticle.update({
          where: { id: item.id },
          data: { pdfStatus: "failed", pdfError: "PDF file missing on disk — step 3 will download it again." },
        });
        job.results.failed++;
        consecutiveFailures = 0;
        log(job, "  ✗ PDF file is missing on disk — sent back to step 3");
        continue;
      }

      const result = await transcribeDoiArticle({
        article,
        provider: input.provider,
        modelName: input.modelName,
        concurrency: input.concurrency,
        shouldStop: () => entry.stop,
        send: (ev) => {
          const current = job.current;
          if (!current) return;
          if (ev.type === "start" && ev.skipped > 0) log(job, `  resuming — ${ev.skipped} page(s) already saved`);
          if (ev.type === "page_done") {
            current.pagesDone++;
            if (ev.pageCount) current.pageCount = ev.pageCount;
          }
          if (ev.type === "progress") {
            // Log each page failure once, as it happens, not just at the end.
            const seen = new Set(failedPagesOf(current.progress).map((p) => p.page));
            for (const p of failedPagesOf(ev.progress)) {
              if (!seen.has(p.page)) log(job, `  ✗ page ${p.page}: ${p.error ?? "failed"}`);
            }
            current.progress = ev.progress;
            if (ev.progress.pageCount) current.pageCount = ev.progress.pageCount;
          }
          if (ev.type === "pages_finished") current.pageCount = ev.pageCount;
        },
      });

      const after = vlmInfoFor(await vlmInfoByDoi([item.doi]), item.doi);
      const pages = `${after.pagesDone}/${after.pageCount ?? "?"} pages`;
      if (after.state === "done") {
        job.results.done++;
        consecutiveFailures = 0;
        log(job, `  ✓ ${pages}`);
      } else if (after.state === "partial") {
        job.results.partial++;
        consecutiveFailures = 0;
        log(job, `  ◐ ${pages}${result.error ? ` — ${result.error}` : ""}`);
      } else if (result.stopped) {
        log(job, "  stopped before any page was read");
      } else {
        job.results.failed++;
        consecutiveFailures++;
        log(job, `  ✗ ${result.error ?? "no pages read"}`);
      }
    } catch (err) {
      if (err instanceof TranscriptionBusyError) {
        job.results.skipped++;
        log(job, `  skipped — ${err.message}`);
      } else {
        job.results.failed++;
        consecutiveFailures++;
        log(job, `  ✗ ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      job.processed++;
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      job.status = "failed";
      job.error = `${MAX_CONSECUTIVE_FAILURES} articles in a row failed with nothing read — check that the backend and the vision provider are up.`;
      log(job, job.error);
      break;
    }
  }

  job.current = null;
  job.finishedAt = new Date().toISOString();
  if (job.status !== "failed") job.status = entry.stop ? "stopped" : "done";
  const { done, partial, failed, skipped } = job.results;
  log(
    job,
    `${job.status === "stopped" ? "Stopped" : job.status === "failed" ? "Gave up" : "Finished"} — ${done} fully read, ${partial} partial, ${failed} failed, ${skipped} skipped`
  );
}
