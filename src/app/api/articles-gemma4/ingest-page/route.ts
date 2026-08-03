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

  // Re-transcribing a page invalidates whatever was embedded from its old
  // text. Without this reset the page stays marked "embedded", never
  // re-enters the make-embedding queue, and Qdrant keeps serving chunks of
  // a version of the page that no longer exists. (The Python service also
  // deletes a page's stale points when its content hash stops matching —
  // but it only ever sees pages this queue hands it, so the reset has to
  // happen here for that safeguard to get its chance.)
  const existing = await prisma.articlePage.findUnique({
    where: { articleId_pageNumber: { articleId: article.id, pageNumber } },
    select: { content: true },
  });
  const contentChanged = existing !== null && existing.content !== content;

  await prisma.articlePage.upsert({
    where: { articleId_pageNumber: { articleId: article.id, pageNumber } },
    create: { articleId: article.id, pageNumber, content },
    update: {
      content,
      ...(contentChanged
        ? {
            embeddingStatus: "pending",
            chunkCount: 0,
            embeddedChunks: 0,
            contentHash: null,
            embeddingError: null,
            embeddedAt: null,
          }
        : {}),
    },
  });

  if (contentChanged) {
    await prisma.article
      .update({ where: { id: article.id }, data: { embeddingStatus: "partial", embeddedAt: null } })
      .catch(() => {});
  }

  if (typeof pageCount === "number") {
    await prisma.article.update({ where: { id: article.id }, data: { pageCount } }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
