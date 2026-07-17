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
