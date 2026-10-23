import { stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { pdfRelativePath, resolvePdfPath } from "@/lib/springer-pdf";

/**
 * Records a PDF that now exists on disk for `doi` as an ArticleByDOI row.
 * `source` is "springer" whenever a SpringerArticle with the same DOI
 * exists, so the chat tools can join the two. A re-download replaces the
 * file, so any earlier transcription is kept but its pdf fields refreshed.
 */
export async function registerDownloadedPdf(doi: string, saved: { relativePath: string; size: number }) {
  const springer = await prisma.springerArticle.findUnique({ where: { doi }, select: { id: true } });
  const source = springer ? "springer" : "doi";
  return prisma.articleByDOI.upsert({
    where: { doi },
    create: { doi, source, pdfPath: saved.relativePath, pdfSize: saved.size },
    update: { source, pdfPath: saved.relativePath, pdfSize: saved.size },
  });
}

/**
 * The ArticleByDOI row for `doi`, created on the fly if its PDF is already
 * on disk (e.g. downloaded by a Springer stage 3 batch, which doesn't
 * register rows itself). Null when there's no PDF for this DOI at all.
 */
export async function ensureArticleByDoi(doi: string) {
  const existing = await prisma.articleByDOI.findUnique({ where: { doi } });
  if (existing) return existing;
  const relativePath = pdfRelativePath(doi);
  const info = await stat(resolvePdfPath(relativePath)).catch(() => null);
  if (!info?.isFile()) return null;
  return registerDownloadedPdf(doi, { relativePath, size: info.size });
}
