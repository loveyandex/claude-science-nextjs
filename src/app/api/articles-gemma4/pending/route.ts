import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchArticleList, ArticlesSourceError } from "@/lib/articles-source";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Same shape as /api/articles/pending, but diffs against gemmaStatus
// (the make-science-gemma4 pipeline's own tracking field) instead of the
// old pipeline's status — a url can be indexed by one pipeline and not
// the other.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  try {
    const allUrls = await fetchArticleList();
    const existing = await prisma.article.findMany({
      where: { url: { in: allUrls } },
      select: { url: true, gemmaStatus: true },
    });
    type ArticleUrlGemmaStatus = { url: string; gemmaStatus: string | null };
    const indexedUrls = new Set(
      existing
        .filter((e: ArticleUrlGemmaStatus) => e.gemmaStatus === "indexed")
        .map((e: ArticleUrlGemmaStatus) => e.url)
    );
    const pending = allUrls.filter((u) => !indexedUrls.has(u));

    return NextResponse.json({
      total: allUrls.length,
      indexed: indexedUrls.size,
      pendingCount: pending.length,
      pending,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ArticlesSourceError && err.status ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
