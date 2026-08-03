import { prisma } from "@/lib/prisma";

/**
 * All Postgres reads/writes for the make-embedding pipeline, in one place.
 *
 * The API routes above this are deliberately thin — they handle auth,
 * shape the HTTP response, and stream events. Which rows count as "work
 * left to do", and what a page's status becomes after a batch, are
 * decisions that belong to one module so the indexing route, the
 * progress-ingest route, and the stats endpoint can't drift apart on the
 * definition.
 */

/** Statuses that mean "there is still work to do on this page". */
export const RESUMABLE_STATUSES = ["pending", "partial", "failed"] as const;

export type EmbeddingRunMode = "resume" | "all";

export type PageForEmbedding = {
  pageId: string;
  articleId: string;
  articleUrl: string;
  pageNumber: number;
  content: string;
  title: string;
  abstract: string;
  startChunk: number;
  contentHash: string | null;
};

export type EmbeddingProgress = {
  pageId: string;
  status: string;
  chunkCount: number;
  embeddedChunks: number;
  contentHash: string | null;
  model: string | null;
  error: string | null;
};

export type EmbeddingStats = {
  articles: { withPages: number; embedded: number; partial: number; pending: number };
  pages: { total: number; embedded: number; partial: number; pending: number; failed: number };
  chunks: { embedded: number; known: number };
};

// A page with no transcription can't be embedded — it isn't "pending
// work", it's nothing. Excluded everywhere so it never inflates the
// pending count or gets shipped to the backend as an empty batch.
const HAS_CONTENT = { content: { not: "" } } as const;

export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  const [total, embedded, partial, pending, failed, chunkSums, articleGroups] = await Promise.all([
    prisma.articlePage.count({ where: HAS_CONTENT }),
    prisma.articlePage.count({ where: { ...HAS_CONTENT, embeddingStatus: "embedded" } }),
    prisma.articlePage.count({ where: { ...HAS_CONTENT, embeddingStatus: "partial" } }),
    prisma.articlePage.count({ where: { ...HAS_CONTENT, embeddingStatus: "pending" } }),
    prisma.articlePage.count({ where: { ...HAS_CONTENT, embeddingStatus: "failed" } }),
    prisma.articlePage.aggregate({
      where: HAS_CONTENT,
      _sum: { embeddedChunks: true, chunkCount: true },
    }),
    prisma.article.groupBy({
      by: ["embeddingStatus"],
      _count: { _all: true },
      where: { pages: { some: HAS_CONTENT } },
    }),
  ]);

  type Group = { embeddingStatus: string | null; _count: { _all: number } };
  const byStatus = new Map<string, number>(
    (articleGroups as Group[]).map((g) => [g.embeddingStatus ?? "pending", g._count._all])
  );
  const articlesWithPages = Array.from(byStatus.values()).reduce((a, b) => a + b, 0);

  return {
    articles: {
      withPages: articlesWithPages,
      embedded: byStatus.get("embedded") ?? 0,
      partial: byStatus.get("partial") ?? 0,
      pending: (byStatus.get("pending") ?? 0) + (byStatus.get("failed") ?? 0),
    },
    pages: { total, embedded, partial, pending, failed },
    chunks: {
      embedded: chunkSums._sum.embeddedChunks ?? 0,
      known: chunkSums._sum.chunkCount ?? 0,
    },
  };
}

export type QueuedPage = {
  pageId: string;
  articleId: string;
  pageNumber: number;
  articleTitle: string;
  articleUrl: string;
};

/**
 * The work queue, resolved once at the start of a run.
 *
 * Deliberately IDs-and-labels only, with page content loaded per batch by
 * `loadPagesForEmbedding`: a run can cover hundreds of pages of markdown,
 * and holding all of it in memory for the whole run buys nothing.
 *
 * Resolving the whole queue up front (rather than re-querying "what's
 * pending?" between batches) also means a page that fails repeatedly is
 * attempted exactly once per run. Re-querying would keep handing back the
 * same failing page forever.
 *
 * Ordered by article then page number so a run walks a paper
 * front-to-back — the feed reads as "page 3 of 12" instead of jumping
 * around, and stopping early leaves whole articles finished rather than a
 * scatter of half-done ones.
 */
export async function findPageQueue(args: {
  limit: number;
  mode: EmbeddingRunMode;
  articleId?: string;
}): Promise<QueuedPage[]> {
  const rows = await prisma.articlePage.findMany({
    where: {
      ...HAS_CONTENT,
      ...(args.articleId ? { articleId: args.articleId } : {}),
      // "all" re-walks every page. The backend still skips any page whose
      // content hash and chunk cursor say it's already complete, so this
      // is a cheap way to verify a collection rather than a forced redo —
      // a real redo goes through resetEmbeddingState() first.
      ...(args.mode === "all"
        ? {}
        : { embeddingStatus: { in: RESUMABLE_STATUSES as unknown as string[] } }),
    },
    orderBy: [{ articleId: "asc" }, { pageNumber: "asc" }],
    take: args.limit,
    select: {
      id: true,
      articleId: true,
      pageNumber: true,
      article: { select: { url: true, title: true } },
    },
  });

  type Row = (typeof rows)[number];
  return (rows as Row[]).map((row) => ({
    pageId: row.id,
    articleId: row.articleId,
    pageNumber: row.pageNumber,
    articleTitle: row.article?.title ?? "",
    articleUrl: row.article?.url ?? "",
  }));
}

/**
 * Loads one batch's worth of full page rows. `startChunk`/`contentHash`
 * are read here, as late as possible, so a batch always resumes from the
 * cursor as it stands *now* — including progress written by the backend's
 * heartbeats during an earlier batch of the same run.
 */
export async function loadPagesForEmbedding(pageIds: string[]): Promise<PageForEmbedding[]> {
  if (pageIds.length === 0) return [];
  const rows = await prisma.articlePage.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true,
      articleId: true,
      pageNumber: true,
      content: true,
      embeddedChunks: true,
      contentHash: true,
      article: { select: { url: true, title: true, abstract: true } },
    },
  });

  type Row = (typeof rows)[number];
  const byId = new Map<string, Row>((rows as Row[]).map((r) => [r.id, r]));
  // Preserve the caller's ordering — the queue is already sorted, and the
  // progress feed reads better if the backend processes it that way.
  return pageIds
    .map((id) => byId.get(id))
    .filter((row): row is Row => Boolean(row))
    .map((row) => ({
      pageId: row.id,
      articleId: row.articleId,
      articleUrl: row.article?.url ?? "",
      pageNumber: row.pageNumber,
      content: row.content,
      title: row.article?.title ?? "",
      abstract: row.article?.abstract ?? "",
      startChunk: row.embeddedChunks,
      contentHash: row.contentHash,
    }));
}

/** Live chunk cursors for a batch — polled while the backend works. */
export async function readPageProgress(pageIds: string[]) {
  if (pageIds.length === 0) return [];
  return prisma.articlePage.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true,
      articleId: true,
      pageNumber: true,
      embeddingStatus: true,
      chunkCount: true,
      embeddedChunks: true,
    },
  });
}

export async function countPagesNeedingEmbedding(mode: EmbeddingRunMode = "resume"): Promise<number> {
  return prisma.articlePage.count({
    where: {
      ...HAS_CONTENT,
      ...(mode === "all"
        ? {}
        : { embeddingStatus: { in: RESUMABLE_STATUSES as unknown as string[] } }),
    },
  });
}

/**
 * Applies one progress report. Called both by the backend's mid-page
 * heartbeats (via /api/embeddings/ingest-progress) and by the indexing
 * route with each batch's final results — the same write either way, so
 * a dropped heartbeat is caught up by the batch result and vice versa.
 */
export async function applyPageProgress(progress: EmbeddingProgress): Promise<void> {
  await prisma.articlePage.update({
    where: { id: progress.pageId },
    data: {
      embeddingStatus: progress.status,
      chunkCount: progress.chunkCount,
      embeddedChunks: progress.embeddedChunks,
      contentHash: progress.contentHash,
      embeddingModel: progress.model,
      embeddingError: progress.error,
      embeddedAt: progress.status === "embedded" ? new Date() : null,
    },
  });
}

/**
 * Rolls the per-page truth up onto the article. Called once an article's
 * pages have been through a batch, so /library and the stat cards can
 * answer "is this paper searchable?" without aggregating pages per read.
 */
export async function recomputeArticleEmbeddingStatus(articleId: string): Promise<string> {
  const [total, embedded, failed] = await Promise.all([
    prisma.articlePage.count({ where: { articleId, ...HAS_CONTENT } }),
    prisma.articlePage.count({ where: { articleId, ...HAS_CONTENT, embeddingStatus: "embedded" } }),
    prisma.articlePage.count({ where: { articleId, ...HAS_CONTENT, embeddingStatus: "failed" } }),
  ]);

  let status: string;
  if (total === 0) status = "pending";
  else if (embedded === total) status = "embedded";
  else if (embedded > 0) status = "partial";
  else if (failed > 0) status = "failed";
  else status = "pending";

  await prisma.article.update({
    where: { id: articleId },
    data: {
      embeddingStatus: status,
      embeddedAt: status === "embedded" ? new Date() : null,
    },
  });
  return status;
}

/**
 * Forgets everything Postgres knows about embedding, for one article or
 * for all of them. Only ever half the job: the vectors themselves live in
 * Qdrant and are dropped separately (see /api/embeddings/reset, which
 * does both) — clearing one without the other is what leaves orphans.
 */
export async function resetEmbeddingState(articleId?: string): Promise<number> {
  const pageWhere = articleId ? { articleId } : {};
  const result = await prisma.articlePage.updateMany({
    where: pageWhere,
    data: {
      embeddingStatus: "pending",
      chunkCount: 0,
      embeddedChunks: 0,
      contentHash: null,
      embeddingModel: null,
      embeddingError: null,
      embeddedAt: null,
    },
  });
  await prisma.article.updateMany({
    where: articleId ? { id: articleId } : {},
    data: { embeddingStatus: null, embeddedAt: null },
  });
  return result.count;
}

/** Live per-page state for one article — powers the /make-embedding detail view. */
export async function getArticleEmbeddingDetail(articleId: string) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      url: true,
      title: true,
      pageCount: true,
      embeddingStatus: true,
      pages: {
        where: HAS_CONTENT,
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          embeddingStatus: true,
          chunkCount: true,
          embeddedChunks: true,
          embeddingError: true,
        },
      },
    },
  });
  return article;
}
