import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getEmbeddingSettings } from "@/lib/embedding-settings";
import {
  applyPageProgress,
  countPagesNeedingEmbedding,
  findPageQueue,
  loadPagesForEmbedding,
  readPageProgress,
  recomputeArticleEmbeddingStatus,
  type EmbeddingRunMode,
  type QueuedPage,
} from "@/lib/embedding-repository";
import { embedPages, isBackendConfigured } from "@/lib/embedding-backend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The make-embedding orchestrator. Mirrors /api/articles-gemma4/index's
 * shape on purpose — same NDJSON-over-a-ReadableStream contract, same
 * "poll Postgres for live progress while the Python call is in flight"
 * trick — so the two indexing pages can share a mental model even though
 * the pipelines have nothing else in common.
 *
 * Why the loop lives here rather than in Python: resume state is database
 * state, and the Next.js app owns the database. Keeping the Python
 * service stateless (a batch of pages in, results out) is what makes
 * stopping trivial — stopping means "don't send the next batch", and
 * every chunk already embedded stays embedded.
 */

const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGE_LIMIT = 2000;
const POLL_INTERVAL_MS = 900;

type Event =
  | {
      type: "start";
      totalPages: number;
      remainingBefore: number;
      collection: string;
      model: string;
      chunkTokens: number;
      chunkOverlap: number;
      pageBatch: number;
    }
  | { type: "article_start"; articleId: string; title: string; url: string; pageCount: number }
  | {
      type: "page_progress";
      articleId: string;
      pageId: string;
      pageNumber: number;
      embeddedChunks: number;
      chunkCount: number;
      status: string;
    }
  | {
      type: "page_done";
      articleId: string;
      pageId: string;
      pageNumber: number;
      chunkCount: number;
      embeddedChunks: number;
      status: string;
      restarted: boolean;
      skipped: boolean;
      error: string | null;
    }
  | { type: "article_done"; articleId: string; title: string; status: string; chunks: number }
  | { type: "stopped"; reason: string }
  | { type: "fatal"; message: string }
  | {
      type: "done";
      pagesProcessed: number;
      chunksEmbedded: number;
      failedPages: number;
      remaining: number;
    };

function encodeEvent(ev: Event): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  if (!isBackendConfigured()) {
    return Response.json(
      {
        error:
          "INTERNAL_API_SECRET is not configured — set it in .env (the same value backend/.env uses).",
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const limit =
    typeof body?.limit === "number" && body.limit > 0
      ? Math.min(Math.floor(body.limit), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
  const mode: EmbeddingRunMode = body?.mode === "all" ? "all" : "resume";
  const articleId = typeof body?.articleId === "string" && body.articleId ? body.articleId : undefined;

  // Two ways a run ends early, and both have to reach the loop: the
  // browser aborting the fetch (the Stop button), and the response stream
  // being cancelled. Either one flips the same flag; the loop checks it
  // between batches, which is exactly where stopping is safe.
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  req.signal.addEventListener("abort", stop);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (ev: Event) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(ev));
        } catch {
          // Client went away mid-write — nothing to recover, just stop.
          closed = true;
          stopped = true;
        }
      };

      try {
        const settings = await getEmbeddingSettings();
        const queue = await findPageQueue({ limit, mode, articleId });
        const remainingBefore = await countPagesNeedingEmbedding("resume");

        send({
          type: "start",
          totalPages: queue.length,
          remainingBefore,
          collection: settings.collection,
          model: settings.model,
          chunkTokens: settings.chunkTokens,
          chunkOverlap: settings.chunkOverlap,
          pageBatch: settings.pageBatch,
        });

        if (queue.length === 0) {
          send({ type: "done", pagesProcessed: 0, chunksEmbedded: 0, failedPages: 0, remaining: remainingBefore });
          return;
        }

        const articleMeta = new Map<string, QueuedPage>();
        const articlePageCount = new Map<string, number>();
        // Which page id closes out each article in this run — the trigger
        // for recomputing that article's rolled-up status exactly once,
        // rather than after every batch that happens to touch it.
        const lastPageOfArticle = new Map<string, string>();
        for (const page of queue) {
          if (!articleMeta.has(page.articleId)) articleMeta.set(page.articleId, page);
          articlePageCount.set(page.articleId, (articlePageCount.get(page.articleId) ?? 0) + 1);
          lastPageOfArticle.set(page.articleId, page.pageId);
        }

        const announcedArticles = new Set<string>();
        const articleChunkTotals = new Map<string, number>();
        let pagesProcessed = 0;
        let chunksEmbedded = 0;
        let failedPages = 0;

        for (const batch of chunkArray(queue, settings.pageBatch)) {
          if (stopped) break;

          for (const page of batch) {
            if (announcedArticles.has(page.articleId)) continue;
            announcedArticles.add(page.articleId);
            const meta = articleMeta.get(page.articleId)!;
            send({
              type: "article_start",
              articleId: page.articleId,
              title: meta.articleTitle || meta.articleUrl,
              url: meta.articleUrl,
              pageCount: articlePageCount.get(page.articleId) ?? 0,
            });
          }

          const batchIds = batch.map((p) => p.pageId);
          const pages = await loadPagesForEmbedding(batchIds);
          if (pages.length === 0) continue;

          let settled = false;
          const backendCall = embedPages(
            {
              pages,
              collection: settings.collection,
              chunking: {
                maxTokens: settings.chunkTokens,
                overlapTokens: settings.chunkOverlap,
              },
            },
            req.signal
          ).finally(() => {
            settled = true;
          });

          // Live progress: the backend writes its per-batch heartbeats to
          // Postgres through /api/embeddings/ingest-progress, so polling
          // those same rows turns them into browser events without a
          // second channel back from Python.
          const seen = new Map<string, number>();
          const pollOnce = async () => {
            const rows = await readPageProgress(batchIds);
            for (const row of rows) {
              if (seen.get(row.id) === row.embeddedChunks) continue;
              seen.set(row.id, row.embeddedChunks);
              send({
                type: "page_progress",
                articleId: row.articleId,
                pageId: row.id,
                pageNumber: row.pageNumber,
                embeddedChunks: row.embeddedChunks,
                chunkCount: row.chunkCount,
                status: row.embeddingStatus,
              });
            }
          };

          while (!settled && !stopped) {
            await delay(POLL_INTERVAL_MS);
            if (settled) break;
            await pollOnce().catch(() => {});
          }

          const outcome = await backendCall;

          if (!outcome.ok) {
            // Reaching the backend failed, or it reported an
            // environment-level problem (Qdrant down, model won't load).
            // Every earlier batch is already durable, so stopping here
            // costs nothing but the current batch.
            send({ type: "stopped", reason: outcome.error });
            return;
          }
          if (!outcome.data.ok) {
            send({ type: "stopped", reason: outcome.data.error || "The embedding backend reported a failure." });
            return;
          }

          // The backend's returned results are authoritative — the
          // heartbeats are just an early view of the same numbers. Write
          // them, so a batch whose heartbeats were all dropped still
          // records its progress.
          for (const result of outcome.data.results) {
            await applyPageProgress({
              pageId: result.pageId,
              status: result.status,
              chunkCount: result.chunkCount,
              embeddedChunks: result.embeddedChunks,
              contentHash: result.contentHash,
              model: result.model,
              error: result.error,
            }).catch(() => {});

            pagesProcessed += 1;
            chunksEmbedded += result.embeddedChunks;
            if (result.status === "failed") failedPages += 1;
            articleChunkTotals.set(
              result.articleId,
              (articleChunkTotals.get(result.articleId) ?? 0) + result.embeddedChunks
            );

            send({
              type: "page_done",
              articleId: result.articleId,
              pageId: result.pageId,
              pageNumber: result.pageNumber,
              chunkCount: result.chunkCount,
              embeddedChunks: result.embeddedChunks,
              status: result.status,
              restarted: result.restarted,
              skipped: result.skipped,
              error: result.error,
            });
          }

          // Roll up any article whose last queued page was in this batch.
          const batchIdSet = new Set(batchIds);
          const finishedArticles = new Set(
            batch
              .map((p) => p.articleId)
              .filter((id) => {
                const lastPageId = lastPageOfArticle.get(id);
                return lastPageId ? batchIdSet.has(lastPageId) : false;
              })
          );
          for (const id of finishedArticles) {
            const status = await recomputeArticleEmbeddingStatus(id).catch(() => "partial");
            send({
              type: "article_done",
              articleId: id,
              title: articleMeta.get(id)?.articleTitle || "",
              status,
              chunks: articleChunkTotals.get(id) ?? 0,
            });
          }
        }

        if (stopped) {
          send({
            type: "stopped",
            reason:
              "Stopped by request. Every chunk embedded so far is saved — starting again resumes from the next unfinished chunk.",
          });
          return;
        }

        const remaining = await countPagesNeedingEmbedding("resume");
        send({ type: "done", pagesProcessed, chunksEmbedded, failedPages, remaining });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Embedding run failed";
        send({ type: "fatal", message });
      } finally {
        req.signal.removeEventListener("abort", stop);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
