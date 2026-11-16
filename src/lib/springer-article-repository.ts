import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function findSpringerArticles(where: Prisma.SpringerArticleWhereInput, oldestFirst: boolean, offset: number, limit: number) {
  const [articles, total] = await Promise.all([
    prisma.springerArticle.findMany({
      where,
      orderBy: [{ createdAt: oldestFirst ? "asc" : "desc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        doi: true,
        href: true,
        title: true,
        section: true,
        publishedDate: true,
        openAccess: true,
        abstract: true,
        status: true,
        pdfStatus: true,
        createdAt: true,
        journal: { select: { id: true, journalId: true, name: true } },
      },
    }),
    prisma.springerArticle.count({ where }),
  ]);

  return { articles, total };
}
