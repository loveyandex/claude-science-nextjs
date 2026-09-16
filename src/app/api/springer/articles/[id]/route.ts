import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const article = await prisma.springerArticle.findUnique({
    where: { id: params.id },
    include: { journal: { select: { id: true, journalId: true, name: true } } },
  });
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });

  return Response.json({ article });
}
