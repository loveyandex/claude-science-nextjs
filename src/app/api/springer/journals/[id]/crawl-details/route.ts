import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchArticleDetail, SpringerCrawlError } from "@/lib/springer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_LIMIT = 15;

type Event =
  | { type: "batch_start"; total: number }
  | { type: "start"; doi: string; index: number; total: number }
  | { type: "success"; doi: string; title: string; openAccess: boolean; hasContent: boolean }
  | { type: "error"; doi: string; message: string }
  | { type: "done"; processed: number; remaining: number }
  | { type: "fatal"; message: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// Second stage of the Springer pipeline: for stub rows created by
// crawl-list (status "pending"), visits each article's own page and fills
// in abstract/openAccess/content. Split from crawl-list because visiting
// every article is ~50x the requests of listing them, and a paywalled
// article only ever yields an abstract — no point fetching it during the
// cheap list pass.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(50, Math.max(1, typeof body?.limit === "number" ? body.limit : DEFAULT_BATCH_LIMIT));

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));

      const pendingTotal = await prisma.springerArticle.count({
        where: { journalId: journal.id, status: "pending" },
      });
      const batch = await prisma.springerArticle.findMany({
        where: { journalId: journal.id, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: limit,
      });

      send({ type: "batch_start", total: batch.length });
      let processed = 0;

      for (let i = 0; i < batch.length; i++) {
        const article = batch[i];
        send({ type: "start", doi: article.doi, index: i + 1, total: batch.length });

        try {
          const detail = await fetchArticleDetail(article.doi);
          await prisma.springerArticle.update({
            where: { id: article.id },
            data: {
              title: detail.title || article.title,
              abstract: detail.abstract,
              openAccess: detail.openAccess,
              content: detail.content,
              status: "indexed",
              errorReason: null,
            },
          });
          processed++;
          send({
            type: "success",
            doi: article.doi,
            title: detail.title || article.title,
            openAccess: detail.openAccess,
            hasContent: !!detail.content,
          });
        } catch (err) {
          const message =
            err instanceof SpringerCrawlError || err instanceof Error ? err.message : "Failed to crawl article";
          await prisma.springerArticle
            .update({ where: { id: article.id }, data: { status: "failed", errorReason: message } })
            .catch(() => {});
          send({ type: "error", doi: article.doi, message });
        }
      }

      send({ type: "done", processed, remaining: pendingTotal - processed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
