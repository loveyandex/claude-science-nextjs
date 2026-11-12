import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { vlmCounts } from "@/lib/springer-vlm";

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

  const [indexed, pending, openAccess, pdfGroups, vlm] = await Promise.all([
    prisma.springerArticle.count({ where: { journalId: journal.id, status: "indexed" } }),
    prisma.springerArticle.count({ where: { journalId: journal.id, status: "pending" } }),
    prisma.springerArticle.count({ where: { journalId: journal.id, openAccess: true } }),
    prisma.springerArticle.groupBy({
      by: ["pdfStatus"],
      where: { journalId: journal.id },
      _count: { _all: true },
    }),
    vlmCounts(journal.id),
  ]);
  const pdfCount = (status: string | null) =>
    pdfGroups.find((g) => g.pdfStatus === status)?._count._all ?? 0;

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
      pdf: {
        downloaded: pdfCount("downloaded"),
        notFound: pdfCount("not_found"),
        failed: pdfCount("failed"),
        untried: pdfCount(null),
      },
      vlm,
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
