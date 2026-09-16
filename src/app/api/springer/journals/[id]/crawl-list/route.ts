import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchJournalListPage, SpringerCrawlError } from "@/lib/springer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_PAGE_COUNT = 3;

type Event =
  | { type: "page_start"; page: number; index: number; total: number }
  | { type: "page_done"; page: number; found: number; totalArticles: number | null }
  | { type: "stopped"; reason: string }
  | { type: "done"; pagesCrawled: number; articlesFound: number }
  | { type: "fatal"; message: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// Crawls the next N pages of a journal's article list (50 articles/page on
// Springer), starting right after `lastListPage`, and upserts each as a
// stub SpringerArticle row (doi/title/href only — no abstract yet, that's
// crawl-details). Resumable by design: `lastListPage` only advances after
// a page's articles are successfully saved.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const pageCount = Math.min(
    20,
    Math.max(1, typeof body?.pageCount === "number" ? body.pageCount : DEFAULT_PAGE_COUNT)
  );

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));
      let pagesCrawled = 0;
      let articlesFound = 0;
      let cursor = journal.lastListPage;

      for (let i = 0; i < pageCount; i++) {
        const nextPage = cursor + 1;
        send({ type: "page_start", page: nextPage, index: i + 1, total: pageCount });

        let result;
        try {
          result = await fetchJournalListPage(journal.journalId, nextPage);
        } catch (err) {
          const message =
            err instanceof SpringerCrawlError || err instanceof Error
              ? err.message
              : "Failed to crawl list page";
          send({ type: "stopped", reason: `Page ${nextPage}: ${message}` });
          break;
        }

        if (result.articles.length === 0) {
          send({ type: "stopped", reason: `Page ${nextPage} returned no articles — likely past the last page` });
          break;
        }

        for (const a of result.articles) {
          await prisma.springerArticle.upsert({
            where: { doi: a.doi },
            create: {
              journalId: journal.id,
              doi: a.doi,
              href: a.href,
              title: a.title,
              section: a.section,
              publishedDate: a.publishedDate,
              openAccess: a.openAccess,
              status: "pending",
            },
            update: {
              title: a.title,
              section: a.section,
              publishedDate: a.publishedDate,
              openAccess: a.openAccess,
            },
          });
        }

        cursor = nextPage;
        pagesCrawled++;
        articlesFound += result.articles.length;

        await prisma.springerJournal.update({
          where: { id: journal.id },
          data: {
            lastListPage: cursor,
            ...(result.totalArticles != null ? { totalArticles: result.totalArticles } : {}),
          },
        });

        send({ type: "page_done", page: nextPage, found: result.articles.length, totalArticles: result.totalArticles });
      }

      send({ type: "done", pagesCrawled, articlesFound });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
