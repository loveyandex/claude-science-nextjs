import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDefaultModel } from "@/lib/ai-provider";
import { fetchArticleList, buildPdfUrl } from "@/lib/articles-source";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getEnabledKeyValues, getConcurrencyMode } from "@/lib/gemma4-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_LIMIT = 20;
// Page-1 markdown from Gemma can be long (real transcription, not just
// noisy OCR text) — cap what we send the title/abstract-extraction model
// so one huge page doesn't blow the context window or the budget.
const MAX_CHARS_TO_MODEL = 6000;
// How often to poll Postgres for newly-arrived pages while waiting on the
// backend's /index-article call — this is what turns the backend's
// already-working per-page pushes into live progress in the browser,
// without needing a second channel (gRPC, SSE from the backend, etc.)
// back from the Python side. Postgres is already the shared state both
// sides agree on.
const POLL_INTERVAL_MS = 1200;

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

const extractionSchema = z.object({
  title: z
    .string()
    .describe("The paper's real title, cleaned up (no running headers, no journal name)."),
  abstract: z
    .string()
    .describe(
      "The paper's abstract, verbatim from the text where possible. If no abstract is present on the page, write a 2-3 sentence factual summary of what the page does contain instead of inventing one."
    ),
});

type BackendPage = {
  ok: true;
  pageCount: number;
  failedPages: { page: number; error: string }[];
  allKeysRateLimited: boolean;
};
type BackendFailure = { ok: false; error: string };
type BackendOutcome =
  | BackendPage
  | BackendFailure
  | { httpError: true; status: number; statusText: string }
  | { networkError: true; message: string };

type Event =
  | { type: "list_fetched"; total: number; pendingCount: number }
  | { type: "start"; url: string }
  | { type: "page_done"; url: string; page: number }
  | {
      type: "success";
      url: string;
      pdfUrl: string;
      title: string;
      abstract: string;
      pageCount: number;
      failedPageCount: number;
    }
  | { type: "llm_error"; url: string; message: string }
  | { type: "fetch_error"; url: string; status: number; statusText: string }
  | { type: "rate_limited"; url: string; message: string }
  | { type: "stopped"; reason: string }
  | { type: "done"; processed: number; remaining: number }
  | { type: "fatal"; message: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ArticleResult = "success" | "llm_error" | "stop";

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  if (!INTERNAL_API_SECRET) {
    return Response.json(
      { error: "INTERNAL_API_SECRET is not configured — set it in .env (same value backend/.env uses)." },
      { status: 500 }
    );
  }

  let limit = DEFAULT_BATCH_LIMIT;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, 100);
    }
  } catch {
    // ignore — use default
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));

      const keys = await getEnabledKeyValues();
      if (keys.length === 0) {
        send({
          type: "fatal",
          message: "No Cerebras API keys are configured — add one at /settings before indexing.",
        });
        controller.close();
        return;
      }
      const concurrencyMode = await getConcurrencyMode();

      let allUrls: string[];
      try {
        allUrls = await fetchArticleList();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch article list";
        send({ type: "fatal", message });
        controller.close();
        return;
      }

      const existing = await prisma.article.findMany({
        where: { url: { in: allUrls }, gemmaStatus: "indexed" },
        select: { url: true },
      });
      const indexedSet = new Set(existing.map((e: { url: string }) => e.url));
      const pending = allUrls.filter((u) => !indexedSet.has(u));

      send({ type: "list_fetched", total: allUrls.length, pendingCount: pending.length });

      const batch = pending.slice(0, limit);
      let processed = 0;
      let stopRequested = false;

      // Handles one article end-to-end: create/find its Article shell,
      // figure out which pages already exist (resume support), call the
      // backend with whichever key(s) this call gets, poll Postgres for
      // live per-page progress while waiting, then extract title/abstract
      // from page 1's markdown once the backend call resolves.
      const processArticle = async (url: string, keysForCall: string[]): Promise<ArticleResult> => {
        send({ type: "start", url });
        const pdfUrl = buildPdfUrl(url);

        // Ensure an Article shell row exists before the backend starts
        // pushing pages — articles-gemma4/ingest-page looks the article
        // up by url and 404s if it isn't there yet. Doesn't touch
        // title/abstract/status if the row already exists (e.g. already
        // indexed by the old /make-science pipeline) — only gemma4's own
        // fields get written here and after a successful run below.
        const article = await prisma.article.upsert({
          where: { url },
          create: {
            url,
            pdfUrl,
            title: url,
            abstract: "",
            status: "failed",
            errorReason: "Not yet processed by /make-science.",
          },
          update: { pdfUrl },
          select: { id: true },
        });

        // Pages already saved from a previous partial/failed run on this
        // article — tell the backend to skip re-transcribing them, and
        // surface them to the browser immediately as already-done.
        const alreadySaved = await prisma.articlePage.findMany({
          where: { articleId: article.id },
          select: { pageNumber: true },
        });
        const seenPages = new Set(alreadySaved.map((p: { pageNumber: number }) => p.pageNumber));
        for (const p of seenPages) {
          send({ type: "page_done", url, page: p });
        }

        let backendSettled = false;
        const backendPromise: Promise<BackendOutcome> = fetch(`${BACKEND_URL}/index-article`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_API_SECRET },
          body: JSON.stringify({ url, pdfUrl, skipPages: Array.from(seenPages), cerebrasApiKeys: keysForCall }),
        })
          .then(async (res) => {
            backendSettled = true;
            if (!res.ok) {
              return { httpError: true, status: res.status, statusText: res.statusText } as const;
            }
            return (await res.json()) as BackendPage | BackendFailure;
          })
          .catch((err) => {
            backendSettled = true;
            return {
              networkError: true,
              message: err instanceof Error ? err.message : "Network error reaching the backend.",
            } as const;
          });

        // Poll Postgres for newly-arrived pages while the backend call is
        // in flight — this is the live per-page progress signal.
        while (!backendSettled) {
          await delay(POLL_INTERVAL_MS);
          if (backendSettled) break;
          const rows = await prisma.articlePage.findMany({
            where: { articleId: article.id },
            select: { pageNumber: true },
          });
          for (const { pageNumber } of rows) {
            if (!seenPages.has(pageNumber)) {
              seenPages.add(pageNumber);
              send({ type: "page_done", url, page: pageNumber });
            }
          }
        }

        const outcome = await backendPromise;

        // One last catch-up poll — a page can land in the tiny window
        // between the final "settled" flip and this line.
        const finalRows = await prisma.articlePage.findMany({
          where: { articleId: article.id },
          select: { pageNumber: true },
        });
        for (const { pageNumber } of finalRows) {
          if (!seenPages.has(pageNumber)) {
            seenPages.add(pageNumber);
            send({ type: "page_done", url, page: pageNumber });
          }
        }

        if ("httpError" in outcome || "networkError" in outcome) {
          const status = "httpError" in outcome ? outcome.status : 0;
          const statusText = "httpError" in outcome ? outcome.statusText : "network error";
          send({ type: "fetch_error", url, status, statusText });
          send({
            type: "stopped",
            reason: `Stopped at ${url}: couldn't reach the gemma4 backend at ${BACKEND_URL} — is it running (see backend/README.md)?`,
          });
          return "stop";
        }

        if (!outcome.ok) {
          const message = outcome.error;
          // A partial run may have saved some pages before failing —
          // "partial" (not "failed") so the next batch resumes instead of
          // starting over, as long as at least one page made it in.
          const gemmaStatus = seenPages.size > 0 ? "partial" : "failed";
          await prisma.article
            .update({ where: { id: article.id }, data: { gemmaStatus, gemmaError: message } })
            .catch(() => {});
          send({ type: "llm_error", url, message });
          return "llm_error";
        }

        const failedPages = outcome.failedPages ?? [];
        let result: ArticleResult = "success";

        try {
          if (!seenPages.has(1)) {
            throw new Error("Page 1 wasn't transcribed, so no title/abstract could be extracted.");
          }
          const page1 = await prisma.articlePage.findUnique({
            where: { articleId_pageNumber: { articleId: article.id, pageNumber: 1 } },
            select: { content: true },
          });
          if (!page1) {
            throw new Error("Backend reported page 1 done but its markdown wasn't found.");
          }

          const truncated = page1.content.slice(0, MAX_CHARS_TO_MODEL);
          const { object } = await generateObject({
            model: await getDefaultModel(),
            schema: extractionSchema,
            system:
              "You extract clean bibliographic metadata from a markdown transcription of the first page of an academic PDF (produced by a vision model, so formatting may be imperfect but the actual text content is real). Return only the real title and the real abstract.",
            prompt: `Markdown transcription of a PDF's first page:\n\n"""\n${truncated}\n"""\n\nIdentify the paper's actual title and its abstract.`,
          });

          const gemmaStatus = failedPages.length > 0 ? "partial" : "indexed";
          const gemmaError =
            failedPages.length > 0
              ? `${failedPages.length} page(s) failed: ${failedPages
                  .map((p) => `page ${p.page} (${p.error})`)
                  .join("; ")}`
              : null;

          await prisma.article.update({
            where: { id: article.id },
            data: {
              title: object.title,
              abstract: object.abstract,
              pageCount: outcome.pageCount,
              gemmaStatus,
              gemmaError,
            },
          });

          send({
            type: "success",
            url,
            pdfUrl,
            title: object.title,
            abstract: object.abstract,
            pageCount: outcome.pageCount,
            failedPageCount: failedPages.length,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown abstract-extraction error";
          await prisma.article
            .update({ where: { id: article.id }, data: { gemmaStatus: "partial", gemmaError: message } })
            .catch(() => {});
          send({ type: "llm_error", url, message });
          result = "llm_error";
        }

        if (outcome.allKeysRateLimited) {
          send({
            type: "rate_limited",
            url,
            message: "All Cerebras API keys given to this call were rate-limited while processing this article.",
          });
          send({
            type: "stopped",
            reason:
              "Every key in the pool got rate-limited — indexing paused so it doesn't keep hammering the same limit(s). Pages already transcribed are saved; re-run later (or add more keys at /settings) to resume.",
          });
          return "stop";
        }

        return result;
      };

      if (concurrencyMode === "pdfs_per_key") {
        // One key per concurrently-processed article — up to `concurrency`
        // articles in flight at once, each sequential internally (backend
        // gets exactly one key, so its thread pool degenerates to size 1).
        const concurrency = Math.max(1, Math.min(keys.length, batch.length));
        let cursor = 0;
        const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
          const myKey = keys[workerIndex % keys.length];
          while (!stopRequested) {
            const idx = cursor++;
            if (idx >= batch.length) break;
            const result = await processArticle(batch[idx], [myKey]);
            if (result === "success") processed++;
            if (result === "stop") stopRequested = true;
          }
        });
        await Promise.all(workers);
      } else {
        // pages_per_pdf (default): one article at a time, every enabled
        // key handed to the backend so it splits that article's pages
        // across all of them concurrently.
        for (const url of batch) {
          if (stopRequested) break;
          const result = await processArticle(url, keys);
          if (result === "success") processed++;
          if (result === "stop") {
            stopRequested = true;
            break;
          }
        }
      }

      if (!stopRequested) {
        send({ type: "done", processed, remaining: pending.length - processed });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
