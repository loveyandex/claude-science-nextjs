// Shapes and wording for the backend's live "make science" progress (GET
// /doi/jobs/{id}.progress). No server imports, so the browser can use it.

// Times are unix seconds, as Python's time.time() gives them.
export type PageActivity = {
  page: number;
  state: "queued" | "running" | "retrying" | "done" | "failed" | "cancelled";
  attempt?: number;
  error?: string;
  startedAt?: number;
  retryAt?: number;
  at: number;
};

export type BackendProgress = {
  phase: "starting" | "downloading" | "rendering" | "transcribing" | "finished" | "failed";
  message: string;
  pageCount: number | null;
  pages: PageActivity[];
  updatedAt: number;
};

// backend/app/services/transcription.py VISION_MAX_ATTEMPTS
export const MAX_ATTEMPTS_PER_PAGE = 5;

const secondsSince = (t: number | undefined, now: number) => (t ? Math.max(0, Math.round(now - t)) : 0);

function describePage(p: PageActivity, now: number): string | null {
  const attempt = p.attempt && p.attempt > 1 ? ` (attempt ${p.attempt}/${MAX_ATTEMPTS_PER_PAGE})` : "";
  if (p.state === "running") return `page ${p.page}: waiting for the model, ${secondsSince(p.startedAt, now)}s${attempt}`;
  if (p.state === "retrying") {
    const left = p.retryAt ? Math.max(0, Math.round(p.retryAt - now)) : 0;
    return `page ${p.page}: ${p.error ?? "error"} — retrying in ${left}s${attempt}`;
  }
  return null;
}

/** One line saying what the run is doing right now. `now` is unix seconds. */
export function describeProgress(progress: BackendProgress, now: number = Date.now() / 1000): string {
  if (progress.phase !== "transcribing") return progress.message;
  const busy = progress.pages
    .filter((p) => p.state === "running" || p.state === "retrying")
    .map((p) => describePage(p, now))
    .filter(Boolean);
  return busy.length ? busy.join(" · ") : progress.message;
}

export function failedPagesOf(progress: BackendProgress | null): PageActivity[] {
  return progress?.pages.filter((p) => p.state === "failed") ?? [];
}
