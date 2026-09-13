import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDefaultModel } from "@/lib/ai-provider";
import { extractFirstPageText } from "@/lib/pdf";
import { fetchArticleList, buildPdfUrl, ArticlesSourceError } from "@/lib/articles-source";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_LIMIT = 20;
// First-page text can be noisy (headers, journal boilerplate, running
// titles). Cap what we send the LLM so one huge PDF doesn't blow the
// context window or the budget.
const MAX_CHARS_TO_MODEL = 6000;

const extractionSchema = z.object({
  title: z
    .string()
    .describe("The paper's real title, cleaned up (no running headers, no journal name)."),
  abstract: z
    .string()
    .describe(
      "The paper's abstract, verbatim from the text where possible. If no abstract is present on the page, write a 2-3 sentence factual summary of what the page does contain instead of inventing one."
    ),
});

type Event =
  | { type: "list_fetched"; total: number; pendingCount: number }
  | { type: "start"; url: string; index: number; total: number }
  | { type: "success"; url: string; pdfUrl: string; title: string; abstract: string }
  | { type: "llm_error"; url: string; message: string }
  | { type: "fetch_error"; url: string; status: number; statusText: string }
  | { type: "stopped"; reason: string }
  | { type: "done"; processed: number; remaining: number }
  | { type: "fatal"; message: string };

function encodeEvent(ev: Event) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  let limit = DEFAULT_BATCH_LIMIT;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, 100);
    }
  } catch {
    // ignore — use default
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encodeEvent(ev));

      let allUrls: string[];
      try {
        allUrls = await fetchArticleList();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch article list";
        send({ type: "fatal", message });
        controller.close();
        return;
      }

      const existing = await prisma.article.findMany({
        where: { url: { in: allUrls }, status: "indexed" },
        select: { url: true },
      });
      const indexedSet = new Set(existing.map((e: { url: string }) => e.url));
      const pending = allUrls.filter((u) => !indexedSet.has(u));

      send({ type: "list_fetched", total: allUrls.length, pendingCount: pending.length });

      const batch = pending.slice(0, limit);
      let processed = 0;

      for (let i = 0; i < batch.length; i++) {
        const url = batch[i];
        send({ type: "start", url, index: i + 1, total: batch.length });

        const pdfUrl = buildPdfUrl(url);
        let pdfRes: Response;
        try {
          pdfRes = await fetch(pdfUrl, { cache: "no-store" });
        } catch (err) {
          // Network-level failure fetching the PDF — treat the same as a
          // bad HTTP status: stop the whole loop rather than hammering a
          // repo that's gone away.
          send({ type: "fetch_error", url, status: 0, statusText: "network error" });
          send({ type: "stopped", reason: `Network error fetching ${pdfUrl}` });
          controller.close();
          return;
        }

        if (!pdfRes.ok) {
          send({ type: "fetch_error", url, status: pdfRes.status, statusText: pdfRes.statusText });
          send({
            type: "stopped",
            reason: `Stopped at ${url}: repo responded ${pdfRes.status} ${pdfRes.statusText}`,
          });
          controller.close();
          return;
        }

        try {
          const bytes = await pdfRes.arrayBuffer();
          const { firstPageText, pageCount } = await extractFirstPageText(bytes);
          const truncated = firstPageText.slice(0, MAX_CHARS_TO_MODEL);

          const { object } = await generateObject({
            model: await getDefaultModel(),
            schema: extractionSchema,
            system:
              "You extract clean bibliographic metadata from raw, messy text taken from the first page of a scanned/converted academic PDF. The text may contain OCR noise, running headers, journal names, DOIs, and page numbers mixed in with the real title and abstract. Return only the real title and the real abstract.",
            prompt: `Raw first-page text extracted from a PDF:\n\n"""\n${truncated}\n"""\n\nIdentify the paper's actual title and its abstract.`,
          });

          await prisma.article.upsert({
            where: { url },
            create: {
              url,
              pdfUrl,
              title: object.title,
              abstract: object.abstract,
              pageCount,
              status: "indexed",
            },
            update: {
              pdfUrl,
              title: object.title,
              abstract: object.abstract,
              pageCount,
              status: "indexed",
              errorReason: null,
            },
          });

          processed++;
          send({ type: "success", url, pdfUrl, title: object.title, abstract: object.abstract });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown extraction error";
          await prisma.article
            .upsert({
              where: { url },
              create: {
                url,
                pdfUrl,
                title: url,
                abstract: "",
                status: "failed",
                errorReason: message,
              },
              update: { status: "failed", errorReason: message },
            })
            .catch(() => {});
          send({ type: "llm_error", url, message });
          // LLM/parsing errors don't stop the batch — only bad HTTP
          // responses from the repo do, per spec. Keep going.
        }
      }

      send({ type: "done", processed, remaining: pending.length - processed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
