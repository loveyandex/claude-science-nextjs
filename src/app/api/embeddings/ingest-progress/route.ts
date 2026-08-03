import { NextResponse } from "next/server";
import { checkInternalSecret, unauthorized } from "@/lib/auth";
import { applyPageProgress } from "@/lib/embedding-repository";

export const dynamic = "force-dynamic";

/**
 * Called by the Python service as it embeds, once per upsert batch, so a
 * long page reports "4 of 11 chunks" while it's still in flight.
 *
 * Same shape of arrangement as /api/articles-gemma4/ingest-page: the
 * Python side never opens a database connection, it pushes here and this
 * route does the only write. Auth is the shared X-Internal-Secret, not a
 * user JWT — there's no browser in this call path.
 *
 * The write is intentionally idempotent (absolute counts, not
 * increments), because a retried or duplicated ping must not be able to
 * advance a resume cursor past what's actually in Qdrant.
 */
export async function POST(req: Request) {
  if (!checkInternalSecret(req)) return unauthorized("Invalid internal secret.");

  const body = await req.json().catch(() => null);
  const { pageId, status, chunkCount, embeddedChunks, contentHash, model, error } = (body ??
    {}) as Record<string, unknown>;

  if (typeof pageId !== "string" || !pageId || typeof status !== "string") {
    return NextResponse.json(
      { error: "pageId (string) and status (string) are required." },
      { status: 400 }
    );
  }

  try {
    await applyPageProgress({
      pageId,
      status,
      chunkCount: typeof chunkCount === "number" ? chunkCount : 0,
      embeddedChunks: typeof embeddedChunks === "number" ? embeddedChunks : 0,
      contentHash: typeof contentHash === "string" ? contentHash : null,
      model: typeof model === "string" ? model : null,
      error: typeof error === "string" ? error : null,
    });
  } catch (err) {
    // A page deleted mid-run (article re-indexed underneath us) is the
    // realistic case here. Nothing to update is not a failure worth
    // aborting the backend's batch over.
    const message = err instanceof Error ? err.message : "Failed to record progress";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
