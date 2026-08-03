import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getEmbeddingSettings, updateEmbeddingSettings } from "@/lib/embedding-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();
  return NextResponse.json(await getEmbeddingSettings());
}

/**
 * Changing chunkTokens/model here doesn't silently corrupt anything:
 * both are folded into each page's content hash, so pages embedded under
 * the old settings simply stop matching and get re-embedded (their stale
 * vectors deleted first) the next time they're picked up. The response
 * says as much so the UI can warn before the user finds out by watching
 * a full re-run.
 */
export async function PATCH(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const before = await getEmbeddingSettings();
  const settings = await updateEmbeddingSettings(body);

  const invalidates =
    settings.chunkTokens !== before.chunkTokens ||
    settings.chunkOverlap !== before.chunkOverlap ||
    settings.model !== before.model;

  return NextResponse.json({
    ...settings,
    // True when the change alters how existing pages would be chunked or
    // encoded — i.e. previously-embedded pages will be redone.
    invalidatesExistingEmbeddings: invalidates,
  });
}
