import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInternalSecret, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Called by the backend/ FastAPI service, once per PDF page, as it finishes
// converting + reading each page. Auth is the shared X-Internal-Secret
// header, not a user JWT — this is a server-to-server call, no browser
// involved. The Article row itself must already exist (created by
// articles-gemma4/index's orchestrator before it calls the backend) —
// this route only ever writes ArticlePage rows plus Article.pageCount.
export async function POST(req: Request) {
  if (!checkInternalSecret(req)) return unauthorized("Invalid internal secret.");

  const body = await req.json().catch(() => null);
  const { url, pageNumber, pageCount, content } = (body ?? {}) as {
    url?: unknown;
    pageNumber?: unknown;
    pageCount?: unknown;
    content?: unknown;
  };

  if (typeof url !== "string" || !url || typeof pageNumber !== "number" || typeof content !== "string") {
    return NextResponse.json(
      { error: "url (string), pageNumber (number), and content (string) are required." },
      { status: 400 }
    );
  }

  const article = await prisma.article.findUnique({ where: { url }, select: { id: true } });
  if (!article) {
    return NextResponse.json(
      {
        error: `No Article shell found for url "${url}". articles-gemma4/index must create it before the backend pushes pages.`,
      },
      { status: 404 }
    );
  }

  await prisma.articlePage.upsert({
    where: { articleId_pageNumber: { articleId: article.id, pageNumber } },
    create: { articleId: article.id, pageNumber, content },
    update: { content },
  });

  if (typeof pageCount === "number") {
    await prisma.article.update({ where: { id: article.id }, data: { pageCount } }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
