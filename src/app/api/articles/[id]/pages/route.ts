import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Full per-page markdown transcription for an article (gemma4 pipeline
// only — the old /make-science pipeline never stores ArticlePage rows).
// Backs the /library/[id]/markdown reader view.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const article = await prisma.article.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, gemmaStatus: true },
  });
  if (!article) {
    return Response.json({ error: "Article not found." }, { status: 404 });
  }

  const pages = await prisma.articlePage.findMany({
    where: { articleId: params.id },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, content: true },
  });

  return Response.json({
    article: { id: article.id, title: article.title, gemmaStatus: article.gemmaStatus },
    pages,
  });
}
