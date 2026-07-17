import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchArticleList, ArticlesSourceError } from "@/lib/articles-source";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allUrls = await fetchArticleList();
    const existing = await prisma.article.findMany({
      where: { url: { in: allUrls } },
      select: { url: true, status: true },
    });
    const indexedUrls = new Set(existing.filter((e) => e.status === "indexed").map((e) => e.url));
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
