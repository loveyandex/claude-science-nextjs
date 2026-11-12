import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchJournalListPage, SpringerCrawlError } from "@/lib/springer";
import { saveListArticles } from "@/lib/springer-save";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_PAGE_COUNT = 3;

type Event =
  | { type: "page_start"; page: number; index: number; total: number }
  | { type: "page_done"; page: number; found: number; added: number; totalArticles: number | null; dois: string[] }
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
  const headless = body?.headless === true;
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
          result = await fetchJournalListPage(journal.journalId, nextPage, { headless });
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

        const added = await saveListArticles(journal.id, result.articles);

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

        send({
          type: "page_done",
          page: nextPage,
          found: result.articles.length,
          added,
          totalArticles: result.totalArticles,
          dois: result.articles.map((a) => a.doi),
        });
      }

      send({ type: "done", pagesCrawled, articlesFound });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
