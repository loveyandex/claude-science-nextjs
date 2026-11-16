import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchIssueArticles, isHistoricalIssue, loadJournalVolumes } from "@/lib/springer";
import { saveListArticles } from "@/lib/springer-save";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ISSUES = 60;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await getAuthFromRequest(req))) return unauthorized();
  const query = new URL(req.url).searchParams;
  const issue = query.get("issue");
  const volume = Number(query.get("volume"));
  if (issue && Number.isSafeInteger(volume) && volume > 0) {
    const crawl = await prisma.springerIssueCrawl.findUnique({
      where: { journalId_volume_issue: { journalId: params.id, volume, issue } },
      select: { dois: true, crawledAt: true },
    });
    return crawl ? Response.json({ crawl }) : Response.json({ error: "Issue has no saved crawl" }, { status: 404 });
  }
  const coverage = await prisma.springerIssueCrawl.findMany({
    where: { journalId: params.id },
    select: { volume: true, issue: true, crawledAt: true, complete: true, dois: true },
  });
  return Response.json({ coverage: coverage.map(({ dois, ...record }) => ({ ...record, count: dois.length })) });
}

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
      cached: boolean;
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
    ? [...new Set<string>(body.issues.map((i: unknown) => String(i).trim()).filter((i: string) => /^[\w-]+$/.test(i)))]
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
        const volumes = await loadJournalVolumes(journal.journalId, { headless }).catch(() => []);
        for (let i = 0; i < issues.length; i++) {
          if (req.signal.aborted) break;
          const issue = issues[i];
          const key = { journalId: journal.id, volume, issue };
          const where = { journalId_volume_issue: key };
          const saved = await prisma.springerIssueCrawl.findUnique({ where });
          if (saved?.complete) {
            send({ type: "issue_done", volume, issue, found: saved.dois.length, added: 0, totalArticles: null, dois: saved.dois, cached: true });
            continue;
          }
          send({ type: "issue_start", volume, issue, index: i + 1, total: issues.length });

          try {
            const result = await fetchIssueArticles(journal.journalId, volume, issue, { headless });
            const dois = [...new Set(result.articles.map((article) => article.doi))];
            if (!dois.length || (result.totalArticles != null && dois.length < result.totalArticles)) {
              throw new Error(`Incomplete issue list (${dois.length} of ${result.totalArticles ?? "unknown"} articles)`);
            }
            const complete = result.totalArticles != null && isHistoricalIssue(volumes, volume, issue);
            const crawledAt = new Date();
            const added = await prisma.$transaction(async (db) => {
              const added = await saveListArticles(journal.id, result.articles, db);
              const data = { dois, complete, crawledAt };
              await db.springerIssueCrawl.upsert({ where, create: { ...key, ...data }, update: data });
              return added;
            });
            issuesCrawled++;
            articlesFound += dois.length;
            articlesAdded += added;
            send({ type: "issue_done", volume, issue, found: dois.length, added, totalArticles: result.totalArticles, dois, cached: false });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to crawl issue";
            send({ type: "issue_error", volume, issue, message });
            continue;
          }

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
