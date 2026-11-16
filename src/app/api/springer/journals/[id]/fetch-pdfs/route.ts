import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getSpringerSettings } from "@/lib/springer-settings";
import { registerDownloadedPdf } from "@/lib/article-by-doi";
import { buildProviderUrl, fetchPdfFromProvider, ProviderBrowser, savePdf } from "@/lib/springer-pdf";
import { parseScopeDois } from "@/lib/springer-save";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_LIMIT = 10;
// A run of hard failures in a row (timeouts, connection refused) almost
// always means the provider itself is down or blocking us — stop rather
// than burn through the whole batch marking everything "failed".
const MAX_CONSECUTIVE_FAILURES = 3;

const state = globalThis as typeof globalThis & { springerPdfBatches?: Set<string> };
const activeBatches = (state.springerPdfBatches ??= new Set());

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await getAuthFromRequest(req))) return unauthorized();
  return Response.json({ running: activeBatches.has(params.id) });
}

type Event =
  | { type: "batch_start"; total: number; provider: string }
  | { type: "start"; doi: string; index: number; total: number; url: string }
  | { type: "challenge"; doi: string; timeoutSec: number }
  | { type: "downloaded"; doi: string; size: number; sourceUrl: string }
  | { type: "not_found"; doi: string; message: string }
  | { type: "error"; doi: string; message: string }
  | { type: "stopped"; reason: string }
  | { type: "fatal"; message: string }
  | { type: "done"; downloaded: number; notFound: number; failed: number; remaining: number };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// Stage 3: pulls each article's full-text PDF from the configured content
// provider (<providerUrl>/<doi>) and stores it on disk. Picks up articles
// never tried (pdfStatus null) and previous hard failures; "not_found"
// rows are only retried when the caller asks, since the provider already
// answered for them. An optional `dois` body field limits the batch to
// those articles.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(50, Math.max(1, typeof body?.limit === "number" ? body.limit : DEFAULT_BATCH_LIMIT));
  const retryNotFound = body?.retryNotFound === true;
  const dois = parseScopeDois(body?.dois);
  if (dois && "error" in dois) return Response.json({ error: dois.error }, { status: 400 });

  const { pdfProviderUrl, challengeTimeoutSec } = await getSpringerSettings();
  if (!pdfProviderUrl) {
    return Response.json(
      { error: "No PDF provider URL configured — set it in Settings → Springer." },
      { status: 400 }
    );
  }

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const where = {
    journalId: journal.id,
    ...(dois ? { doi: { in: dois } } : {}),
    OR: [
      { pdfStatus: null },
      { pdfStatus: "failed" },
      ...(retryNotFound ? [{ pdfStatus: "not_found" }] : []),
    ],
  };

  if (activeBatches.has(journal.id)) {
    return Response.json({ error: "A PDF download batch is already running for this journal." }, { status: 409 });
  }
  activeBatches.add(journal.id);
  let disconnected = false;
  const stream = new ReadableStream({
    cancel() {
      disconnected = true;
    },
    async start(controller) {
      const send = (ev: Event) => {
        if (!disconnected) controller.enqueue(encodeEvent(ev));
      };

      try {
        const pendingTotal = await prisma.springerArticle.count({ where });
        const batch = await prisma.springerArticle.findMany({
          where,
          orderBy: { createdAt: "asc" },
          take: limit,
          select: { id: true, doi: true },
        });

        send({ type: "batch_start", total: batch.length, provider: pdfProviderUrl });
        let downloaded = 0;
        let notFound = 0;
        let failed = 0;
        let consecutiveFailures = 0;

        // One browser for the whole batch — see ProviderBrowser.
        const browser = new ProviderBrowser();
        try {
          for (let i = 0; i < batch.length; i++) {
            if (disconnected || req.signal.aborted) break;
            const { id, doi } = batch[i];
            const url = buildProviderUrl(pdfProviderUrl, doi);
            send({ type: "start", doi, index: i + 1, total: batch.length, url });

            try {
              const result = await fetchPdfFromProvider(browser, url, {
                challengeTimeoutMs: challengeTimeoutSec * 1000,
                onChallenge: () => send({ type: "challenge", doi, timeoutSec: challengeTimeoutSec }),
              });
              if (result.kind === "pdf") {
                const saved = await savePdf(doi, result.bytes);
                await registerDownloadedPdf(doi, saved);
                await prisma.springerArticle.update({
                  where: { id },
                  data: {
                    pdfStatus: "downloaded",
                    pdfPath: saved.relativePath,
                    pdfSize: saved.size,
                    pdfSourceUrl: result.sourceUrl,
                    pdfError: null,
                    pdfCheckedAt: new Date(),
                  },
                });
                downloaded++;
                send({ type: "downloaded", doi, size: saved.size, sourceUrl: result.sourceUrl });
              } else {
                await prisma.springerArticle.update({
                  where: { id },
                  data: {
                    pdfStatus: "not_found",
                    pdfSourceUrl: result.finalUrl,
                    pdfError: result.message,
                    pdfCheckedAt: new Date(),
                  },
                });
                notFound++;
                send({ type: "not_found", doi, message: result.message });
              }
              consecutiveFailures = 0;
            } catch (err) {
              const message = err instanceof Error ? err.message.split("\n")[0] : "PDF fetch failed";
              await prisma.springerArticle
                .update({
                  where: { id },
                  data: { pdfStatus: "failed", pdfError: message, pdfCheckedAt: new Date() },
                })
                .catch(() => {});
              failed++;
              consecutiveFailures++;
              send({ type: "error", doi, message });
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                send({
                  type: "stopped",
                  reason: `${MAX_CONSECUTIVE_FAILURES} failures in a row — the provider may be down, blocking requests, or showing a CAPTCHA nobody solved.`,
                });
                break;
              }
            }
          }
        } finally {
          await browser.close();
        }

        // not_found rows leave the pool (unless retryNotFound), failed ones stay in it.
        const remaining = pendingTotal - downloaded - (retryNotFound ? 0 : notFound);
        send({ type: "done", downloaded, notFound, failed, remaining });
      } catch (err) {
        send({ type: "fatal", message: err instanceof Error ? err.message : "PDF batch failed" });
      } finally {
        activeBatches.delete(journal.id);
        if (!disconnected) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
