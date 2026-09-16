import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { fetchJournalMeta, SpringerCrawlError } from "@/lib/springer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const journals = await prisma.springerJournal.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { articles: true } } },
  });

  return Response.json({
    journals: journals.map((j) => ({
      id: j.id,
      journalId: j.journalId,
      name: j.name,
      url: j.url,
      lastListPage: j.lastListPage,
      totalArticles: j.totalArticles,
      articleCount: j._count.articles,
      createdAt: j.createdAt,
    })),
  });
}

// Registers a Springer journal by its numeric id (the path segment in
// link.springer.com/journal/<id>) — fetches the journal's real title via a
// live crawl so the journal doesn't just show up as a bare number.
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const journalId = typeof body?.journalId === "string" ? body.journalId.trim() : "";
  if (!journalId || !/^\d+$/.test(journalId)) {
    return Response.json({ error: "journalId must be a numeric Springer journal id, e.g. 10853" }, { status: 400 });
  }

  const existing = await prisma.springerJournal.findUnique({ where: { journalId } });
  if (existing) {
    return Response.json({ error: `Journal ${journalId} is already registered` }, { status: 409 });
  }

  try {
    const meta = await fetchJournalMeta(journalId);
    const journal = await prisma.springerJournal.create({
      data: { journalId, name: meta.name, url: meta.url },
    });
    return Response.json({ journal }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof SpringerCrawlError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to fetch journal metadata";
    return Response.json({ error: message }, { status: 502 });
  }
}
