import { generateText } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDefaultModel } from "@/lib/ai-provider";
import type { BackendProgress } from "@/lib/transcribe-progress";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";
const POLL_INTERVAL_MS = 1200;
const BACKEND_GONE_MS = 60_000;
// A slow provider can go minutes between pages; a silent stream that long
// gets cut by clients/proxies with idle timeouts.
const HEARTBEAT_MS = 15_000;
const MAX_CHARS_TO_MODEL = 6000;
// Lower than the Cerebras pipeline's PDF_RENDER_DPI default (400): vision
// models downscale anyway, and a 400-dpi page base64'd into every request
// is slow to send to a remote openai-compatible endpoint.
const DEFAULT_DPI = 200;

export function internalSecretConfigured() {
  return !!INTERNAL_API_SECRET;
}

const extractionSchema = z.object({
  title: z.string().describe("The paper's real title, cleaned up (no running headers, no journal name)."),
  abstract: z
    .string()
    .describe(
      "The paper's abstract, verbatim from the text where possible. If no abstract is present on the page, write a 2-3 sentence factual summary of what the page does contain instead of inventing one."
    ),
});

type FailedPage = { page: number; error: string };

type BackendOutcome =
  | { ok: true; pageCount: number; failedPages: FailedPage[]; cancelledPages?: number[] }
  | { ok: false; error: string };

export type TranscribeEvent =
  | { type: "start"; doi: string; provider: string; model: string; skipped: number }
  | { type: "page_done"; page: number; pageCount: number | null }
  | { type: "progress"; progress: BackendProgress }
  | { type: "stopping" }
  | { type: "heartbeat"; pagesDone: number }
  | { type: "pages_finished"; pageCount: number; failedPages: FailedPage[] }
  | { type: "metadata"; title: string; abstract: string; from: "pdf" | "springer" }
  | { type: "error"; message: string }
  | { type: "done"; status: string | null };

export type VisionProviderType = "openai-compatible" | "google";

export type VisionProviderConfig = {
  type: VisionProviderType;
  label: string;
  // Required for openai-compatible; optional for google (Google's own endpoint).
  baseUrl: string | null;
  apiKey: string | null;
};

/**
 * An enabled AiProvider that can transcribe page images: openai-compatible
 * (needs a baseUrl) or google (Gemini API). Which model accepts images is
 * up to the user's pick — the backend reports a model that doesn't.
 */
export async function loadVisionProvider(
  providerId: unknown
): Promise<{ provider: VisionProviderConfig } | { error: string }> {
  const row = await prisma.aiProvider.findUnique({ where: { id: String(providerId ?? "") } });
  if (!row || !row.enabled) return { error: "Pick an enabled AI provider" };
  if (row.type === "google") {
    return { provider: { type: "google", label: row.label, baseUrl: row.baseUrl || null, apiKey: row.apiKey } };
  }
  if (row.type === "openai-compatible") {
    if (!row.baseUrl) return { error: `${row.label} has no base URL — set one in Settings → AI Providers` };
    return { provider: { type: "openai-compatible", label: row.label, baseUrl: row.baseUrl, apiKey: row.apiKey } };
  }
  return { error: `Provider type "${row.type}" can't transcribe images` };
}

export type TranscribeResult = {
  // null only when a stop came before any page was saved and the article
  // had never been transcribed — it stays "not read" rather than "failed".
  status: string | null;
  error: string | null;
  stopped: boolean;
  pagesDone: number;
  pageCount: number | null;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A run whose backend progress hasn't moved for this long is given up on:
// the backend bounds each provider request and its retries well below
// this, so silence that long means something is wedged (e.g. rendering).
const STALL_MS = 15 * 60_000;

// One live run per DOI, in this server process. Lets a reloaded page find
// and follow a run that's still going, lets it be stopped from anywhere,
// and keeps the single-article panel and the stage-4 job from reading the
// same PDF at once.
export type ActiveTranscription = {
  doi: string;
  provider: string;
  model: string;
  startedAt: string;
  stopRequested: boolean;
  pagesDone: number[];
  progress: BackendProgress | null;
};

const registry = globalThis as unknown as { __doiTranscriptions?: Map<string, ActiveTranscription> };
const active = (registry.__doiTranscriptions ??= new Map());

export class TranscriptionBusyError extends Error {
  constructor(public run: ActiveTranscription) {
    super(`This PDF is already being read (${run.model} on ${run.provider}, started ${new Date(run.startedAt).toLocaleTimeString()}).`);
  }
}

export function getActiveTranscription(doi: string): ActiveTranscription | null {
  return active.get(doi) ?? null;
}

/** Asks a live run to stop: the backend skips the pages it hasn't sent yet. */
export function stopActiveTranscription(doi: string): ActiveTranscription | null {
  const run = active.get(doi);
  if (run) run.stopRequested = true;
  return run ?? null;
}

/**
 * "Make science" for one DOI-fetched PDF that already has an ArticleByDOI
 * row: every page rendered to an image and transcribed to markdown by a
 * vision model on an openai-compatible or Gemini provider (via backend/'s
 * /doi/transcribe-pdf, which pushes pages back through
 * /api/doi-articles/ingest-page), then title + abstract extracted from
 * page 1. Pages already stored are skipped unless `force`, so a re-run
 * resumes. `shouldStop` is polled while pages are in flight; once it
 * returns true the backend is told to skip the remaining pages.
 */
export async function transcribeDoiArticle(opts: {
  article: { id: string; doi: string; pageCount: number | null; status: string | null };
  provider: VisionProviderConfig;
  modelName: string;
  concurrency: number;
  force?: boolean;
  send?: (ev: TranscribeEvent) => void;
  shouldStop?: () => boolean;
}): Promise<TranscribeResult> {
  const doi = opts.article.doi;
  const existing = active.get(doi);
  if (existing) throw new TranscriptionBusyError(existing);

  const run: ActiveTranscription = {
    doi,
    provider: opts.provider.label,
    model: opts.modelName,
    startedAt: new Date().toISOString(),
    stopRequested: false,
    pagesDone: [],
    progress: null,
  };
  active.set(doi, run);
  try {
    return await runTranscription(opts, run);
  } catch (err) {
    const message = `Make science crashed: ${err instanceof Error ? err.message : String(err)}`;
    await prisma.articleByDOI
      .update({ where: { id: opts.article.id }, data: { error: message } })
      .catch(() => {});
    throw err;
  } finally {
    active.delete(doi);
  }
}

async function runTranscription(
  opts: Parameters<typeof transcribeDoiArticle>[0],
  run: ActiveTranscription
): Promise<TranscribeResult> {
  const { article, provider, modelName, concurrency, force = false } = opts;
  const shouldStop = () => run.stopRequested || !!opts.shouldStop?.();
  const send = (ev: TranscribeEvent) => {
    if (ev.type === "progress") run.progress = ev.progress;
    if (ev.type === "page_done" && !run.pagesDone.includes(ev.page)) run.pagesDone.push(ev.page);
    opts.send?.(ev);
  };
  const doi = article.doi;

  if (force) await prisma.articleByDOIPage.deleteMany({ where: { articleId: article.id } });
  await prisma.articleByDOI.update({
    where: { id: article.id },
    data: { transcribeProvider: provider.label, transcribeModel: modelName, error: null },
  });

  const alreadySaved = await prisma.articleByDOIPage.findMany({
    where: { articleId: article.id },
    select: { pageNumber: true },
  });
  const seenPages = new Set(alreadySaved.map((p) => p.pageNumber));
  send({ type: "start", doi, provider: provider.label, model: modelName, skipped: seenPages.size });
  for (const p of seenPages) send({ type: "page_done", page: p, pageCount: article.pageCount });

  const backendHeaders = { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_API_SECRET };
  const unreachable = (err: unknown): BackendOutcome => ({
    ok: false,
    error: `Couldn't reach the backend at ${BACKEND_URL} — is it running (see backend/README.md)? ${
      err instanceof Error ? err.message : ""
    }`.trim(),
  });

  // The backend runs the transcription as a job and answers at once —
  // a whole PDF takes longer than fetch will wait for headers (300s).
  let outcome: BackendOutcome | null = null;
  let jobId: string | null = null;
  try {
    const res = await fetch(`${BACKEND_URL}/doi/transcribe-pdf`, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify({
        doi,
        skipPages: Array.from(seenPages),
        provider: { type: provider.type, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: modelName },
        concurrency,
        dpi: DEFAULT_DPI,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      outcome = {
        ok: false,
        error: `Backend returned ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}${
          res.status === 422 && provider.type === "google"
            ? " — the backend may predate Gemini support; restart it"
            : ""
        }`,
      };
    } else jobId = ((await res.json()) as { jobId: string }).jobId;
  } catch (err) {
    outcome = unreachable(err);
  }

  let lastProgressAt = Date.now();
  let lastProgressStamp: number | null = null;
  const pollJob = async (): Promise<BackendOutcome | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/doi/jobs/${jobId}`, { headers: backendHeaders });
      if (res.status === 404) {
        return { ok: false, error: "The backend lost track of this run (it probably restarted) — re-run to resume." };
      }
      if (!res.ok) return null;
      const job = (await res.json()) as { status: string; result?: BackendOutcome; progress?: BackendProgress | null };
      // Older backends don't report progress; the page then only sees pages land.
      if (job.progress && job.progress.updatedAt !== lastProgressStamp) {
        lastProgressStamp = job.progress.updatedAt;
        lastProgressAt = Date.now();
        send({ type: "progress", progress: job.progress });
      }
      return job.status === "done" && job.result ? job.result : null;
    } catch {
      return null;
    }
  };

  const cancelBackendJob = () =>
    // An older backend without the cancel endpoint answers 404/405; the
    // article then just runs to the end before the stop takes effect.
    fetch(`${BACKEND_URL}/doi/jobs/${jobId}/cancel`, { method: "POST", headers: backendHeaders }).catch(() => {});

  const pollPages = async () => {
    const rows = await prisma.articleByDOIPage.findMany({
      where: { articleId: article.id },
      select: { pageNumber: true },
    });
    const fresh = rows.filter((r) => !seenPages.has(r.pageNumber));
    if (fresh.length === 0) return;
    const { pageCount } = (await prisma.articleByDOI.findUnique({
      where: { id: article.id },
      select: { pageCount: true },
    })) ?? { pageCount: null };
    for (const { pageNumber } of fresh) {
      seenPages.add(pageNumber);
      send({ type: "page_done", page: pageNumber, pageCount });
    }
  };

  // A backend that stops answering mid-run (killed, crashed) shouldn't
  // leave this loop spinning forever.
  let unreachableSince: number | null = null;
  let lastHeartbeat = Date.now();
  let stopRequested = false;
  while (!outcome) {
    await delay(POLL_INTERVAL_MS);
    const before = seenPages.size;
    await pollPages();
    if (seenPages.size !== before) lastProgressAt = Date.now();
    if (!stopRequested && shouldStop()) {
      stopRequested = true;
      send({ type: "stopping" });
      await cancelBackendJob();
    }
    if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
      send({ type: "heartbeat", pagesDone: seenPages.size });
      lastHeartbeat = Date.now();
    }
    outcome = await pollJob();
    if (outcome) break;
    if (Date.now() - lastProgressAt > STALL_MS) {
      await cancelBackendJob();
      outcome = {
        ok: false,
        error: `No progress from the backend for ${STALL_MS / 60_000} minutes — gave up on this run. Pages already saved are kept; run again to resume.`,
      };
      break;
    }
    const alive = await fetch(`${BACKEND_URL}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (alive) unreachableSince = null;
    else if (unreachableSince === null) unreachableSince = Date.now();
    else if (Date.now() - unreachableSince > BACKEND_GONE_MS) outcome = unreachable(new Error("stopped responding"));
  }
  await pollPages();

  const stopped = outcome.ok && (outcome.cancelledPages?.length ?? 0) > 0;
  let status: string | null;
  let error: string | null;
  if (!outcome.ok) {
    status = seenPages.size > 0 ? "partial" : "failed";
    error = outcome.error;
  } else {
    send({ type: "pages_finished", pageCount: outcome.pageCount, failedPages: outcome.failedPages });
    const incomplete = outcome.failedPages.length > 0 || stopped;
    status = incomplete ? (seenPages.size > 0 ? "partial" : stopped ? article.status : "failed") : "indexed";
    const parts: string[] = [];
    if (outcome.failedPages.length > 0)
      parts.push(
        `${outcome.failedPages.length} page(s) failed: ${outcome.failedPages
          .map((p) => `page ${p.page} (${p.error})`)
          .join("; ")}`
      );
    if (stopped) parts.push(`stopped with ${outcome.cancelledPages!.length} page(s) not read — run again to resume`);
    error = parts.length ? parts.join(" · ") : null;
  }

  // Runs even when the transcription stopped early — page 1 is all it needs.
  const { metadata, from, extractionError } = await extractMetadata(article.id, doi);
  // A Springer fallback still stored title + abstract. Don't mark the
  // article failed just because the chat model couldn't return JSON.
  if (extractionError && !metadata) error = [error, extractionError].filter(Boolean).join(" · ");

  const pageCount = outcome.ok ? outcome.pageCount : article.pageCount;
  await prisma.articleByDOI.update({
    where: { id: article.id },
    data: {
      status,
      error,
      ...(outcome.ok ? { pageCount: outcome.pageCount } : {}),
      ...(metadata ? { title: metadata.title, abstract: metadata.abstract } : {}),
    },
  });
  if (metadata) send({ type: "metadata", ...metadata, from });
  if (error) send({ type: "error", message: error });
  send({ type: "done", status });

  return { status, error, stopped, pagesDone: seenPages.size, pageCount };
}

function parseExtractionJson(text: string): { title: string; abstract: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model did not return a JSON object");
  return extractionSchema.parse(JSON.parse(body.slice(start, end + 1)));
}

/**
 * Title + abstract from page 1's transcription; falls back to the
 * SpringerArticle record for the same DOI when page 1 isn't transcribed
 * or extraction fails.
 */
async function extractMetadata(articleId: string, doi: string) {
  let metadata: { title: string; abstract: string } | null = null;
  let from: "pdf" | "springer" = "pdf";
  let extractionError: string | null = null;

  const page1 = await prisma.articleByDOIPage.findUnique({
    where: { articleId_pageNumber: { articleId, pageNumber: 1 } },
    select: { content: true },
  });
  if (page1) {
    try {
      // generateObject sends a JSON schema via response_format. The default
      // chat model on this openai-compatible host (gpt-oss) rejects that and
      // returns prose, which the SDK then fails to parse. Ask for JSON in
      // the prompt and parse it ourselves.
      const { text } = await generateText({
        model: await getDefaultModel(),
        system:
          "You extract clean bibliographic metadata from a markdown transcription of the first page of an academic PDF (produced by a vision model, so formatting may be imperfect but the actual text content is real). Reply with one JSON object and nothing else, no markdown fence: {\"title\":\"...\",\"abstract\":\"...\"}. title is the paper's real title. abstract is the paper's abstract, verbatim where possible; if the page has no abstract, a 2-3 sentence factual summary of what the page does contain.",
        prompt: `Markdown transcription of a PDF's first page:\n\n"""\n${page1.content.slice(
          0,
          MAX_CHARS_TO_MODEL
        )}\n"""\n\nIdentify the paper's actual title and its abstract.`,
      });
      metadata = parseExtractionJson(text);
    } catch (err) {
      extractionError = `Title/abstract extraction failed: ${err instanceof Error ? err.message : err}`;
    }
  }
  if (!metadata) {
    const springer = await prisma.springerArticle.findUnique({
      where: { doi },
      select: { title: true, abstract: true },
    });
    if (springer) {
      metadata = { title: springer.title, abstract: springer.abstract ?? "" };
      from = "springer";
    }
  }
  return { metadata, from, extractionError };
}
