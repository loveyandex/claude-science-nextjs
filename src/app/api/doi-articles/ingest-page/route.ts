import { prisma } from "@/lib/prisma";
import { checkInternalSecret, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Called by backend/'s /doi/transcribe-pdf once per finished page — the
// DOI counterpart of articles-gemma4/ingest-page. The ArticleByDOI row
// must already exist (doi-articles/transcribe ensures it before calling).
export async function POST(req: Request) {
  if (!checkInternalSecret(req)) return unauthorized("Invalid internal secret.");

  const body = await req.json().catch(() => null);
  const { doi, pageNumber, pageCount, content } = (body ?? {}) as Record<string, unknown>;
  if (typeof doi !== "string" || !doi || typeof pageNumber !== "number" || typeof content !== "string") {
    return Response.json(
      { error: "doi (string), pageNumber (number), and content (string) are required." },
      { status: 400 }
    );
  }

  const article = await prisma.articleByDOI.findUnique({ where: { doi }, select: { id: true } });
  if (!article) return Response.json({ error: `No ArticleByDOI row for "${doi}"` }, { status: 404 });

  await prisma.articleByDOIPage.upsert({
    where: { articleId_pageNumber: { articleId: article.id, pageNumber } },
    create: { articleId: article.id, pageNumber, content },
    update: { content },
  });
  if (typeof pageCount === "number") {
    await prisma.articleByDOI.update({ where: { id: article.id }, data: { pageCount } }).catch(() => {});
  }

  return Response.json({ ok: true });
}
