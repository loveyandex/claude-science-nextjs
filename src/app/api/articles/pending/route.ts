import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchArticleList, ArticlesSourceError } from "@/lib/articles-source";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  try {
    const allUrls = await fetchArticleList();
    const existing = await prisma.article.findMany({
      where: { url: { in: allUrls } },
      select: { url: true, status: true },
    });
    type ArticleUrlStatus = { url: string; status: string };
    const indexedUrls = new Set(
      existing
        .filter((e: ArticleUrlStatus) => e.status === "indexed")
        .map((e: ArticleUrlStatus) => e.url)
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
