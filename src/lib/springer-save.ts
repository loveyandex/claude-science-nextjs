import { prisma } from "@/lib/prisma";
import type { SpringerListArticle } from "@/lib/springer";

// A whole volume is ~2,000 articles; this leaves room without letting a
// request body grow unbounded.
export const MAX_SCOPE_DOIS = 5000;

/**
 * Reads an optional `dois` array from a request body — the "only these
 * articles" scope that stages 2 and 3 accept (e.g. the articles from the
 * last stage-1 run). `undefined` means no scope: the whole journal.
 */
export function parseScopeDois(value: unknown): string[] | undefined | { error: string } {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return { error: "`dois` must be an array of strings" };
  const dois = Array.from(new Set(value.filter((d): d is string => typeof d === "string" && d.startsWith("10."))));
  if (dois.length > MAX_SCOPE_DOIS) return { error: `At most ${MAX_SCOPE_DOIS} DOIs per scope` };
  return dois;
}

/**
 * Upserts list-crawl results as stub SpringerArticle rows (doi/title/href
 * only — the abstract comes later from crawl-details). Returns how many of
 * them weren't in the database before, since the page and issue crawls
 * overlap and re-seeing an article is normal.
 */
export async function saveListArticles(journalDbId: string, articles: SpringerListArticle[]): Promise<number> {
  const existing = await prisma.springerArticle.findMany({
    where: { doi: { in: articles.map((a) => a.doi) } },
    select: { doi: true },
  });
  const known = new Set(existing.map((e) => e.doi));

  for (const a of articles) {
    await prisma.springerArticle.upsert({
      where: { doi: a.doi },
      create: {
        journalId: journalDbId,
        doi: a.doi,
        href: a.href,
        title: a.title,
        section: a.section,
        publishedDate: a.publishedDate,
        openAccess: a.openAccess,
        status: "pending",
      },
      update: {
        title: a.title,
        section: a.section,
        publishedDate: a.publishedDate,
        openAccess: a.openAccess,
      },
    });
  }
  return articles.filter((a) => !known.has(a.doi)).length;
}
