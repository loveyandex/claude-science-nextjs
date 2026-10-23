import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { parseDoi } from "@/lib/doi";
import { registerDownloadedPdf } from "@/lib/article-by-doi";
import { getSpringerSettings } from "@/lib/springer-settings";
import { buildProviderUrl, fetchPdfFromProvider, ProviderBrowser, savePdf } from "@/lib/springer-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Event =
  | { type: "start"; doi: string; url: string; provider: string }
  | { type: "challenge"; doi: string; timeoutSec: number }
  | { type: "downloaded"; doi: string; size: number; sourceUrl: string }
  | { type: "not_found"; doi: string; message: string }
  | { type: "error"; doi: string; message: string }
  | { type: "done" };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// Single-DOI version of the Springer stage 3 (journals/[id]/fetch-pdfs):
// same provider, browser profile and storage layout, but for one DOI
// pasted by the user. If that DOI is also a crawled SpringerArticle, its
// pdf* columns are updated too so the journal view stays in sync.
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const doi = typeof body?.input === "string" ? parseDoi(body.input) : null;
  if (!doi) {
    return Response.json({ error: "No DOI found — paste a DOI, a doi.org link, or an article URL." }, { status: 400 });
  }

  const { pdfProviderUrl, challengeTimeoutSec } = await getSpringerSettings();
  if (!pdfProviderUrl) {
    return Response.json(
      { error: "No PDF provider URL configured — set it in Settings → Springer." },
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));
      const url = buildProviderUrl(pdfProviderUrl, doi);
      send({ type: "start", doi, url, provider: pdfProviderUrl });

      const browser = new ProviderBrowser();
      try {
        const result = await fetchPdfFromProvider(browser, url, {
          challengeTimeoutMs: challengeTimeoutSec * 1000,
          onChallenge: () => send({ type: "challenge", doi, timeoutSec: challengeTimeoutSec }),
        });
        if (result.kind === "pdf") {
          const saved = await savePdf(doi, result.bytes);
          await registerDownloadedPdf(doi, saved);
          await prisma.springerArticle
            .updateMany({
              where: { doi },
              data: {
                pdfStatus: "downloaded",
                pdfPath: saved.relativePath,
                pdfSize: saved.size,
                pdfSourceUrl: result.sourceUrl,
                pdfError: null,
                pdfCheckedAt: new Date(),
              },
            })
            .catch(() => {});
          send({ type: "downloaded", doi, size: saved.size, sourceUrl: result.sourceUrl });
        } else {
          await prisma.springerArticle
            .updateMany({
              where: { doi, NOT: { pdfStatus: "downloaded" } },
              data: {
                pdfStatus: "not_found",
                pdfSourceUrl: result.finalUrl,
                pdfError: result.message,
                pdfCheckedAt: new Date(),
              },
            })
            .catch(() => {});
          send({ type: "not_found", doi, message: result.message });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message.split("\n")[0] : "PDF fetch failed";
        send({ type: "error", doi, message });
      } finally {
        await browser.close();
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
