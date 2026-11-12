import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchIssueArticles, SpringerCrawlError } from "@/lib/springer";
import { saveListArticles } from "@/lib/springer-save";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ISSUES = 60;

type Event =
  | { type: "issue_start"; volume: number; issue: string; index: number; total: number }
  | {
      type: "issue_done";
      volume: number;
      issue: string;
      found: number;
      added: number;
      totalArticles: number | null;
      dois: string[];
    }
  | { type: "issue_error"; volume: number; issue: string; message: string }
  | { type: "done"; issuesCrawled: number; articlesFound: number; articlesAdded: number }
  | { type: "fatal"; message: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// The volume/issue alternative to crawl-list: crawls each requested issue's
// page and upserts its articles as the same pending stub rows, so stages 2
// and 3 pick them up unchanged. Doesn't touch `lastListPage` — the two modes
// are independent, and an article both of them see is simply upserted twice.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const headless = body?.headless === true;
  const volume = typeof body?.volume === "number" && Number.isInteger(body.volume) && body.volume > 0 ? body.volume : null;
  const issues: string[] = Array.isArray(body?.issues)
    ? body.issues.map((i: unknown) => String(i).trim()).filter((i: string) => /^[\w-]+$/.test(i))
    : [];
  if (volume == null) return Response.json({ error: "A positive integer `volume` is required" }, { status: 400 });
  if (issues.length === 0) return Response.json({ error: "At least one issue is required" }, { status: 400 });
  if (issues.length > MAX_ISSUES) {
    return Response.json({ error: `At most ${MAX_ISSUES} issues per run` }, { status: 400 });
  }

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));
      let issuesCrawled = 0;
      let articlesFound = 0;
      let articlesAdded = 0;

      try {
        for (let i = 0; i < issues.length; i++) {
          const issue = issues[i];
          send({ type: "issue_start", volume, issue, index: i + 1, total: issues.length });

          let result;
          try {
            result = await fetchIssueArticles(journal.journalId, volume, issue, { headless });
          } catch (err) {
            const message =
              err instanceof SpringerCrawlError || err instanceof Error ? err.message : "Failed to crawl issue";
            send({ type: "issue_error", volume, issue, message });
            continue;
          }

          if (result.articles.length === 0) {
            send({ type: "issue_error", volume, issue, message: "no articles on the issue page" });
            continue;
          }

          const added = await saveListArticles(journal.id, result.articles);
          issuesCrawled++;
          articlesFound += result.articles.length;
          articlesAdded += added;
          send({
            type: "issue_done",
            volume,
            issue,
            found: result.articles.length,
            added,
            totalArticles: result.totalArticles,
            dois: result.articles.map((a) => a.doi),
          });
        }
        send({ type: "done", issuesCrawled, articlesFound, articlesAdded });
      } catch (err) {
        send({ type: "fatal", message: err instanceof Error ? err.message : "Issue crawl failed" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
