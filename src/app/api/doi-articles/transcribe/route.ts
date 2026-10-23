import { generateText } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getDefaultModel } from "@/lib/ai-provider";
import { ensureArticleByDoi } from "@/lib/article-by-doi";
import { parseDoi } from "@/lib/doi";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

const extractionSchema = z.object({
  title: z.string().describe("The paper's real title, cleaned up (no running headers, no journal name)."),
  abstract: z
    .string()
    .describe(
      "The paper's abstract, verbatim from the text where possible. If no abstract is present on the page, write a 2-3 sentence factual summary of what the page does contain instead of inventing one."
    ),
});

type BackendOutcome =
  | { ok: true; pageCount: number; failedPages: { page: number; error: string }[] }
  | { ok: false; error: string };

type Event =
  | { type: "start"; doi: string; provider: string; model: string; skipped: number }
  | { type: "page_done"; page: number; pageCount: number | null }
  | { type: "heartbeat"; pagesDone: number }
  | { type: "pages_finished"; pageCount: number; failedPages: { page: number; error: string }[] }
  | { type: "metadata"; title: string; abstract: string; from: "pdf" | "springer" }
  | { type: "error"; message: string }
  | { type: "done"; status: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "make science" for a DOI-fetched PDF: every page rendered to an image and
// transcribed to markdown by a vision model on the chosen openai-compatible
// provider (via backend/'s /doi/transcribe-pdf), stored as
// ArticleByDOIPage rows; then title + abstract extracted from page 1.
// Re-running resumes — pages already stored are skipped unless `force`.
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  if (!INTERNAL_API_SECRET) {
    return Response.json(
      { error: "INTERNAL_API_SECRET is not configured — set it in .env (same value backend/.env uses)." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const doi = typeof body?.doi === "string" ? parseDoi(body.doi) : null;
  if (!doi) return Response.json({ error: "Missing or invalid doi" }, { status: 400 });
  const modelName = typeof body?.modelName === "string" ? body.modelName.trim() : "";
  if (!modelName) return Response.json({ error: "Pick a model to transcribe with" }, { status: 400 });
  const concurrency = Math.min(8, Math.max(1, typeof body?.concurrency === "number" ? body.concurrency : 1));
  const force = body?.force === true;

  const provider = await prisma.aiProvider.findUnique({ where: { id: String(body?.providerId ?? "") } });
  if (!provider || provider.type !== "openai-compatible" || !provider.baseUrl) {
    return Response.json({ error: "Pick an enabled openai-compatible provider" }, { status: 400 });
  }

  const article = await ensureArticleByDoi(doi);
  if (!article) {
    return Response.json({ error: `No downloaded PDF for ${doi} — fetch it first.` }, { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Leaving the page closes the stream, but the run carries on (pages
      // keep arriving, title/abstract still get extracted) — so writes to
      // a closed stream are dropped rather than aborting it.
      let closed = false;
      const send = (ev: Event) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(ev));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

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
            provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: modelName },
            concurrency,
            dpi: DEFAULT_DPI,
          }),
        });
        if (!res.ok) outcome = { ok: false, error: `Backend returned ${res.status} ${res.statusText}` };
        else jobId = ((await res.json()) as { jobId: string }).jobId;
      } catch (err) {
        outcome = unreachable(err);
      }

      const pollJob = async (): Promise<BackendOutcome | null> => {
        try {
          const res = await fetch(`${BACKEND_URL}/doi/jobs/${jobId}`, { headers: backendHeaders });
          if (res.status === 404) {
            return { ok: false, error: "The backend lost track of this run (it probably restarted) — re-run to resume." };
          }
          if (!res.ok) return null;
          const job = (await res.json()) as { status: string; result?: BackendOutcome };
          return job.status === "done" && job.result ? job.result : null;
        } catch {
          return null;
        }
      };

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
      while (!outcome) {
        await delay(POLL_INTERVAL_MS);
        await pollPages();
        if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
          send({ type: "heartbeat", pagesDone: seenPages.size });
          lastHeartbeat = Date.now();
        }
        outcome = await pollJob();
        if (outcome) break;
        const alive = await fetch(`${BACKEND_URL}/health`).then((r) => r.ok).catch(() => false);
        if (alive) unreachableSince = null;
        else if (unreachableSince === null) unreachableSince = Date.now();
        else if (Date.now() - unreachableSince > BACKEND_GONE_MS) outcome = unreachable(new Error("stopped responding"));
      }
      await pollPages();

      let status: string;
      let error: string | null;
      if (!outcome.ok) {
        status = seenPages.size > 0 ? "partial" : "failed";
        error = outcome.error;
      } else {
        send({ type: "pages_finished", pageCount: outcome.pageCount, failedPages: outcome.failedPages });
        status = outcome.failedPages.length > 0 ? "partial" : "indexed";
        error =
          outcome.failedPages.length > 0
            ? `${outcome.failedPages.length} page(s) failed: ${outcome.failedPages
                .map((p) => `page ${p.page} (${p.error})`)
                .join("; ")}`
            : null;
      }

      // Runs even when the transcription stopped early — page 1 is all it needs.
      const { metadata, from, extractionError } = await extractMetadata(article.id, doi);
      // A Springer fallback still stored title + abstract. Don't mark the
      // article failed just because the chat model couldn't return JSON.
      if (extractionError && !metadata) error = [error, extractionError].filter(Boolean).join(" · ");

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
      close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
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
