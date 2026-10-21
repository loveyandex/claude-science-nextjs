import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { parseDoi } from "@/lib/doi";
import { fetchArticleDetail } from "@/lib/springer";
import { getSpringerSettings } from "@/lib/springer-settings";
import { buildProviderUrl, fetchPdfFromProvider, ProviderBrowser, savePdf } from "@/lib/springer-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Event =
  | { type: "details_start"; doi: string; url: string }
  | { type: "journal_created"; journalId: string; name: string }
  | {
      type: "details_done";
      doi: string;
      title: string;
      openAccess: boolean;
      hasContent: boolean;
      created: boolean;
      articleId: string;
      journalDbId: string;
      journalName: string;
    }
  | { type: "pdf_start"; doi: string; url: string }
  | { type: "pdf_skipped"; reason: string }
  | { type: "challenge"; doi: string; timeoutSec: number }
  | { type: "downloaded"; doi: string; size: number; sourceUrl: string }
  | { type: "not_found"; doi: string; message: string }
  | { type: "error"; stage: "details" | "pdf"; doi: string; message: string }
  | { type: "done" };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// Adds one Springer article from a pasted link/DOI, skipping the journal
// list crawl: runs stage 2 (article page → abstract/content) and then
// stage 3 (PDF from the content provider) for just that DOI. The article's
// journal is registered on the fly if it isn't already.
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const doi = typeof body?.input === "string" ? parseDoi(body.input) : null;
  if (!doi) {
    return Response.json(
      { error: "No DOI found — paste a link.springer.com/article/… URL, a doi.org link, or a DOI." },
      { status: 400 }
    );
  }
  const headless = body?.headless === true;
  const wantPdf = body?.fetchPdf !== false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));
      const href = `/article/${doi}`;

      // --- Stage 2: article page -------------------------------------------
      send({ type: "details_start", doi, url: `https://link.springer.com${href}` });
      let articleId: string;
      try {
        const detail = await fetchArticleDetail(doi, { headless });
        if (!detail.title) throw new Error("No article title found — is this a link.springer.com article?");
        if (!detail.journalId) throw new Error("Could not tell which Springer journal this article belongs to");

        let journal = await prisma.springerJournal.findUnique({ where: { journalId: detail.journalId } });
        if (!journal) {
          journal = await prisma.springerJournal.create({
            data: {
              journalId: detail.journalId,
              name: detail.journalName || `Journal ${detail.journalId}`,
              url: `https://link.springer.com/journal/${detail.journalId}`,
            },
          });
          send({ type: "journal_created", journalId: journal.journalId, name: journal.name });
        }

        const existing = await prisma.springerArticle.findUnique({ where: { doi }, select: { id: true } });
        const fields = {
          title: detail.title,
          abstract: detail.abstract,
          openAccess: detail.openAccess,
          content: detail.content,
          status: "indexed",
          errorReason: null,
        };
        const article = await prisma.springerArticle.upsert({
          where: { doi },
          create: {
            ...fields,
            doi,
            href,
            journalId: journal.id,
            section: detail.section,
            publishedDate: detail.publishedDate,
          },
          update: {
            ...fields,
            ...(detail.section ? { section: detail.section } : {}),
            ...(detail.publishedDate ? { publishedDate: detail.publishedDate } : {}),
          },
        });
        articleId = article.id;
        send({
          type: "details_done",
          doi,
          title: article.title,
          openAccess: article.openAccess,
          hasContent: !!article.content,
          created: !existing,
          articleId: article.id,
          journalDbId: journal.id,
          journalName: journal.name,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message.split("\n")[0] : "Failed to crawl article";
        send({ type: "error", stage: "details", doi, message });
        send({ type: "done" });
        controller.close();
        return;
      }

      // --- Stage 3: PDF from the content provider --------------------------
      const { pdfProviderUrl, challengeTimeoutSec } = await getSpringerSettings();
      if (!wantPdf) {
        send({ type: "pdf_skipped", reason: "PDF fetch turned off" });
      } else if (!pdfProviderUrl) {
        send({ type: "pdf_skipped", reason: "No PDF provider URL configured — set it in Settings → Springer." });
      } else {
        const url = buildProviderUrl(pdfProviderUrl, doi);
        send({ type: "pdf_start", doi, url });
        const browser = new ProviderBrowser();
        try {
          const result = await fetchPdfFromProvider(browser, url, {
            challengeTimeoutMs: challengeTimeoutSec * 1000,
            onChallenge: () => send({ type: "challenge", doi, timeoutSec: challengeTimeoutSec }),
          });
          if (result.kind === "pdf") {
            const saved = await savePdf(doi, result.bytes);
            await prisma.springerArticle.update({
              where: { id: articleId },
              data: {
                pdfStatus: "downloaded",
                pdfPath: saved.relativePath,
                pdfSize: saved.size,
                pdfSourceUrl: result.sourceUrl,
                pdfError: null,
                pdfCheckedAt: new Date(),
              },
            });
            send({ type: "downloaded", doi, size: saved.size, sourceUrl: result.sourceUrl });
          } else {
            await prisma.springerArticle.update({
              where: { id: articleId },
              data: {
                pdfStatus: "not_found",
                pdfSourceUrl: result.finalUrl,
                pdfError: result.message,
                pdfCheckedAt: new Date(),
              },
            });
            send({ type: "not_found", doi, message: result.message });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message.split("\n")[0] : "PDF fetch failed";
          await prisma.springerArticle
            .update({
              where: { id: articleId },
              data: { pdfStatus: "failed", pdfError: message, pdfCheckedAt: new Date() },
            })
            .catch(() => {});
          send({ type: "error", stage: "pdf", doi, message });
        } finally {
          await browser.close();
        }
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
