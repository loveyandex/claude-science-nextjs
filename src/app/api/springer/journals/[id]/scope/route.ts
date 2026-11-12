import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { parseScopeDois } from "@/lib/springer-save";
import { vlmCounts } from "@/lib/springer-vlm";

export const dynamic = "force-dynamic";

// Stage counts for a set of articles (the scope stages 2 and 3 can be run
// on), in the same shape as the journal-wide counts on GET /journals/[id].
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const dois = parseScopeDois(body?.dois);
  if (!dois || "error" in dois) {
    return Response.json({ error: dois?.error ?? "`dois` is required" }, { status: 400 });
  }

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const where = { journalId: journal.id, doi: { in: dois } };
  const [statusGroups, pdfGroups, vlm] = await Promise.all([
    prisma.springerArticle.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.springerArticle.groupBy({ by: ["pdfStatus"], where, _count: { _all: true } }),
    vlmCounts(journal.id, dois),
  ]);
  const byStatus = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const byPdf = (s: string | null) => pdfGroups.find((g) => g.pdfStatus === s)?._count._all ?? 0;

  return Response.json({
    scope: {
      total: statusGroups.reduce((n, g) => n + g._count._all, 0),
      indexed: byStatus("indexed"),
      pending: byStatus("pending"),
      failed: byStatus("failed"),
      pdf: {
        downloaded: byPdf("downloaded"),
        notFound: byPdf("not_found"),
        failed: byPdf("failed"),
        untried: byPdf(null),
      },
      vlm,
    },
  });
}
