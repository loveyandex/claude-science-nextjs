import { readFile } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseDoi } from "@/lib/doi";
import { extractAllPageTexts } from "@/lib/pdf";
import { ensureArticleByDoi } from "@/lib/article-by-doi";
import { resolvePdfPath } from "@/lib/springer-pdf";

// Chat tools over the DOI-keyed tables — SpringerArticle (crawled from
// Springer journals) and ArticleByDOI (any PDF fetched by DOI, with its
// vision-model page transcriptions) — which the Article-table tools in
// api/chat/route.ts can't see.

const MAX_PAGES_PER_READ = 5;
const MAX_READ_CHARS = 30000;
const MAX_ABSTRACT_CHARS = 600;
const MAX_CONTENT_CHARS = 8000;

const PDF_STATUSES = ["downloaded", "not_found", "failed", "untried"] as const;

const clip = (s: string | null | undefined, n: number) =>
  s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;

async function transcriptionSummaries(dois: string[]) {
  const rows = await prisma.articleByDOI.findMany({
    where: { doi: { in: dois } },
    select: { doi: true, status: true, pageCount: true, _count: { select: { pages: true } } },
  });
  return new Map(
    rows.map((r) => [r.doi, { status: r.status, pageCount: r.pageCount, pagesTranscribed: r._count.pages }])
  );
}

export const doiArticleTools = {
  searchSpringerArticles: tool({
    description:
      "Search the SpringerArticle table (articles crawled from registered Springer journals — a separate table from the main library) by keyword across title, abstract and DOI, optionally filtered by PDF status. Also returns counts per PDF status. With no query, lists the most recently added rows.",
    inputSchema: z.object({
      query: z.string().optional().describe("Keywords or a DOI fragment. Omit to list recent articles."),
      pdfStatus: z
        .enum(PDF_STATUSES)
        .optional()
        .describe('Only articles whose PDF is "downloaded", "not_found", "failed", or "untried" (never fetched).'),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)."),
    }),
    execute: async ({ query, pdfStatus, limit }) => {
      const q = query?.trim();
      const textFilter = q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { abstract: { contains: q, mode: "insensitive" as const } },
              { doi: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};
      const statusFilter = pdfStatus ? { pdfStatus: pdfStatus === "untried" ? null : pdfStatus } : {};
      const where = { ...textFilter, ...statusFilter };

      const [rows, total, grouped] = await Promise.all([
        prisma.springerArticle.findMany({
          where,
          take: limit ?? 8,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            doi: true,
            title: true,
            abstract: true,
            publishedDate: true,
            section: true,
            openAccess: true,
            status: true,
            pdfStatus: true,
            pdfSize: true,
            journal: { select: { name: true } },
          },
        }),
        prisma.springerArticle.count({ where }),
        prisma.springerArticle.groupBy({ by: ["pdfStatus"], where: textFilter, _count: { _all: true } }),
      ]);
      const transcripts = await transcriptionSummaries(rows.map((r) => r.doi));

      return {
        query: q ?? null,
        total,
        count: rows.length,
        pdfStatusCounts: Object.fromEntries(grouped.map((g) => [g.pdfStatus ?? "untried", g._count._all])),
        results: rows.map((r) => ({
          id: r.id,
          doi: r.doi,
          title: r.title,
          journal: r.journal.name,
          publishedDate: r.publishedDate,
          section: r.section,
          openAccess: r.openAccess,
          crawlStatus: r.status,
          pdfStatus: r.pdfStatus ?? "untried",
          pdfSize: r.pdfSize,
          transcription: transcripts.get(r.doi) ?? null,
          abstract: clip(r.abstract, MAX_ABSTRACT_CHARS),
        })),
      };
    },
  }),

  searchDoiArticles: tool({
    description:
      "Search ArticleByDOI — every PDF downloaded by DOI (Springer or any other publisher), with its page-by-page vision-model transcription status — by keyword across title, abstract and DOI. With no query, lists the most recent.",
    inputSchema: z.object({
      query: z.string().optional().describe("Keywords or a DOI fragment. Omit to list recent articles."),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)."),
    }),
    execute: async ({ query, limit }) => {
      const q = query?.trim();
      const where = q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { abstract: { contains: q, mode: "insensitive" as const } },
              { doi: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};
      const rows = await prisma.articleByDOI.findMany({
        where,
        take: limit ?? 8,
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { pages: true } } },
      });
      return {
        query: q ?? null,
        count: rows.length,
        results: rows.map((r) => ({
          doi: r.doi,
          source: r.source,
          title: r.title,
          pageCount: r.pageCount,
          pagesTranscribed: r._count.pages,
          transcriptionStatus: r.status ?? "not transcribed",
          abstract: clip(r.abstract, MAX_ABSTRACT_CHARS),
        })),
      };
    },
  }),

  getArticleByDoi: tool({
    description:
      "Fetch everything known about one article by DOI (or a doi.org / publisher URL): its SpringerArticle record if any (title, journal, published date, abstract, open-access content, PDF status/path/size, record id) and its ArticleByDOI record (page count, which pages are transcribed). Use before readDoiArticlePages to learn the page count.",
    inputSchema: z.object({
      doi: z.string().min(1).describe('A DOI like "10.1007/s10853-025-11876-5", or a URL containing one.'),
    }),
    execute: async ({ doi: input }) => {
      const doi = parseDoi(input);
      if (!doi) return { error: `"${input}" doesn't contain a DOI.` };

      const [springer, byDoi] = await Promise.all([
        prisma.springerArticle.findUnique({ where: { doi }, include: { journal: { select: { name: true } } } }),
        ensureArticleByDoi(doi),
      ]);
      if (!springer && !byDoi) return { error: `Nothing stored for DOI ${doi} — no Springer record and no PDF.` };

      const pages = byDoi
        ? await prisma.articleByDOIPage.findMany({
            where: { articleId: byDoi.id },
            orderBy: { pageNumber: "asc" },
            select: { pageNumber: true },
          })
        : [];

      return {
        doi,
        title: byDoi?.title || springer?.title || null,
        springer: springer
          ? {
              id: springer.id,
              title: springer.title,
              journal: springer.journal.name,
              publishedDate: springer.publishedDate,
              section: springer.section,
              openAccess: springer.openAccess,
              url: `https://link.springer.com${springer.href}`,
              crawlStatus: springer.status,
              abstract: springer.abstract,
              content: clip(springer.content, MAX_CONTENT_CHARS),
              pdfStatus: springer.pdfStatus ?? "untried",
              pdfPath: springer.pdfPath,
              pdfSize: springer.pdfSize,
              pdfSourceUrl: springer.pdfSourceUrl,
            }
          : null,
        pdf: byDoi
          ? {
              pdfPath: byDoi.pdfPath,
              pdfSize: byDoi.pdfSize,
              pageCount: byDoi.pageCount,
              transcriptionStatus: byDoi.status ?? "not transcribed",
              transcribedPages: pages.map((p) => p.pageNumber),
              transcribedWith: byDoi.transcribeModel,
              extractedTitle: byDoi.title,
              extractedAbstract: byDoi.abstract,
            }
          : null,
        hint: byDoi
          ? "Read the PDF's pages with readDoiArticlePages."
          : "No PDF is downloaded for this DOI, so its pages can't be read.",
      };
    },
  }),

  readDoiArticlePages: tool({
    description: `Read pages of a DOI's downloaded PDF, up to ${MAX_PAGES_PER_READ} pages per call (1-indexed, inclusive range). Returns the vision-model markdown transcription for pages that have one (tables, equations and figure captions included), and falls back to the PDF's raw extracted text for pages that don't. For a long article, call repeatedly with the next range.`,
    inputSchema: z.object({
      doi: z.string().min(1).describe("The article's DOI (or a URL containing it)."),
      fromPage: z.number().int().min(1).describe("First page to read (1-indexed)."),
      toPage: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`Last page to read, inclusive (default fromPage; at most fromPage + ${MAX_PAGES_PER_READ - 1}).`),
    }),
    execute: async ({ doi: input, fromPage, toPage }) => {
      const doi = parseDoi(input);
      if (!doi) return { error: `"${input}" doesn't contain a DOI.` };
      const article = await ensureArticleByDoi(doi);
      if (!article) return { error: `No downloaded PDF for DOI ${doi}.` };

      const last = Math.min(Math.max(toPage ?? fromPage, fromPage), fromPage + MAX_PAGES_PER_READ - 1);
      const transcribed = await prisma.articleByDOIPage.findMany({
        where: { articleId: article.id, pageNumber: { gte: fromPage, lte: last } },
        select: { pageNumber: true, content: true },
      });
      const byPage = new Map(transcribed.map((p) => [p.pageNumber, p.content]));

      let pageCount = article.pageCount;
      let rawPages: string[] | null = null;
      const needsRaw = !pageCount || Array.from({ length: last - fromPage + 1 }, (_, i) => fromPage + i).some((n) => !byPage.has(n));
      if (needsRaw) {
        try {
          // unpdf rejects Node Buffers, even though they are Uint8Arrays.
          const bytes = new Uint8Array(await readFile(resolvePdfPath(article.pdfPath)));
          const extracted = await extractAllPageTexts(bytes);
          rawPages = extracted.pages;
          pageCount = extracted.pageCount;
        } catch (err) {
          if (byPage.size === 0) {
            return { error: `Couldn't read the PDF: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
      }
      if (pageCount && fromPage > pageCount) {
        return { error: `Page ${fromPage} is out of range — this PDF has ${pageCount} page(s).` };
      }

      const end = pageCount ? Math.min(last, pageCount) : last;
      const pages: { pageNumber: number; source: "transcription" | "pdf-text"; content: string }[] = [];
      let budget = MAX_READ_CHARS;
      for (let n = fromPage; n <= end && budget > 0; n++) {
        const md = byPage.get(n);
        const content = md ?? rawPages?.[n - 1] ?? "";
        const sliced = content.slice(0, budget);
        budget -= sliced.length;
        pages.push({ pageNumber: n, source: md ? "transcription" : "pdf-text", content: sliced });
      }

      const lastRead = pages[pages.length - 1]?.pageNumber ?? fromPage;
      return {
        doi,
        title: article.title,
        pageCount,
        fromPage,
        toPage: lastRead,
        pages,
        nextPage: pageCount && lastRead < pageCount ? lastRead + 1 : null,
      };
    },
  }),
};
