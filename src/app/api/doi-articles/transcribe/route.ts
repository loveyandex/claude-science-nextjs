import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { ensureArticleByDoi } from "@/lib/article-by-doi";
import { parseDoi } from "@/lib/doi";
import {
  getActiveTranscription,
  internalSecretConfigured,
  loadVisionProvider,
  transcribeDoiArticle,
  TranscriptionBusyError,
  type TranscribeEvent,
} from "@/lib/doi-transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(ev: TranscribeEvent) {
  return new TextEncoder().encode(JSON.stringify(ev) + "\n");
}

// "make science" for one DOI-fetched PDF, streamed to the page — see
// transcribeDoiArticle for the pipeline itself. Re-running resumes — pages
// already stored are skipped unless `force`.
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  if (!internalSecretConfigured()) {
    return Response.json(
      { error: "INTERNAL_API_SECRET is not configured — set it in .env (same value backend/.env uses)." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const doi = typeof body?.doi === "string" ? parseDoi(body.doi) : null;
  if (!doi) return Response.json({ error: "Missing or invalid doi" }, { status: 400 });
  const modelName = typeof body?.modelName === "string" ? body.modelName.trim() : "";
  if (!modelName) return Response.json({ error: "Pick a model to transcribe with" }, { status: 400 });
  const concurrency = Math.min(8, Math.max(1, typeof body?.concurrency === "number" ? body.concurrency : 1));
  const force = body?.force === true;

  const loaded = await loadVisionProvider(body?.providerId);
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 400 });

  const article = await ensureArticleByDoi(doi);
  if (!article) {
    return Response.json({ error: `No downloaded PDF for ${doi} — fetch it first.` }, { status: 404 });
  }
  const running = getActiveTranscription(doi);
  if (running) return Response.json({ error: new TranscriptionBusyError(running).message }, { status: 409 });

  const stream = new ReadableStream({
    async start(controller) {
      // Leaving the page closes the stream, but the run carries on (pages
      // keep arriving, title/abstract still get extracted) — so writes to
      // a closed stream are dropped rather than aborting it.
      let closed = false;
      const send = (ev: TranscribeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(ev));
        } catch {
          closed = true;
        }
      };

      try {
        await transcribeDoiArticle({
          article,
          provider: loaded.provider,
          modelName,
          concurrency,
          force,
          send,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Make science failed" });
        send({ type: "done", status: "failed" });
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
