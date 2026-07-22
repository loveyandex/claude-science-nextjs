import { getDocumentProxy, extractText } from "unpdf";

export type FirstPageExtraction = {
  firstPageText: string;
  pageCount: number;
};

/**
 * Downloads nothing itself — takes the raw PDF bytes you already fetched
 * and pulls out just the first page's text. We only need page one because
 * that's where the title + abstract live for essentially every paper.
 */
export async function extractFirstPageText(
  pdfBytes: ArrayBuffer | Uint8Array
): Promise<FirstPageExtraction> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];
  const firstPageText = (pages[0] ?? "").trim();

  return { firstPageText, pageCount: totalPages };
}

export type PageExtraction =
  | { ok: true; pageText: string; pageCount: number }
  | { ok: false; error: string; pageCount: number };

/**
 * Extracts one specific 1-indexed page's text from a PDF. Used by the
 * chat `readArticlePage` tool for pages beyond the first (page 1 is
 * already cached on the Article row as `firstPage` and doesn't need this).
 */
export async function extractPageText(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber: number
): Promise<PageExtraction> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  if (pageNumber < 1 || pageNumber > totalPages) {
    return {
      ok: false,
      error: `Page ${pageNumber} is out of range — this PDF has ${totalPages} page(s).`,
      pageCount: totalPages,
    };
  }

  return { ok: true, pageText: (pages[pageNumber - 1] ?? "").trim(), pageCount: totalPages };
}
