import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const journal = await prisma.springerJournal.findUnique({
    where: { id: params.id },
    include: {
      _count: {
        select: { articles: true },
      },
    },
  });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const [indexed, pending, openAccess] = await Promise.all([
    prisma.springerArticle.count({ where: { journalId: journal.id, status: "indexed" } }),
    prisma.springerArticle.count({ where: { journalId: journal.id, status: "pending" } }),
    prisma.springerArticle.count({ where: { journalId: journal.id, openAccess: true } }),
  ]);

  return Response.json({
    journal: {
      id: journal.id,
      journalId: journal.journalId,
      name: journal.name,
      url: journal.url,
      lastListPage: journal.lastListPage,
      totalArticles: journal.totalArticles,
      articleCount: journal._count.articles,
      indexed,
      pending,
      openAccess,
      createdAt: journal.createdAt,
    },
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  await prisma.springerJournal.delete({ where: { id: params.id } }).catch(() => {});
  return Response.json({ ok: true });
}
