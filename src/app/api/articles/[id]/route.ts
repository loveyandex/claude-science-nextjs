import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const article = await prisma.article.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      url: true,
      pdfUrl: true,
      title: true,
      abstract: true,
      pageCount: true,
      status: true,
      gemmaStatus: true,
      createdAt: true,
    },
  });

  if (!article) {
    return Response.json({ error: "Article not found." }, { status: 404 });
  }

  return Response.json({ article });
}
