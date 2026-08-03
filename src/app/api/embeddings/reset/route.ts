import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { resetEmbeddingState } from "@/lib/embedding-repository";
import { getEmbeddingSettings } from "@/lib/embedding-settings";
import { dropCollection } from "@/lib/embedding-backend";

export const dynamic = "force-dynamic";

/**
 * Start over. Postgres's per-page cursors and Qdrant's vectors are two
 * halves of the same state, so this route is the only supported way to
 * clear either — resetting one alone leaves the other as orphans
 * (vectors nothing points at, or cursors claiming work that's gone).
 *
 * Scoped to one article, the Qdrant side is left alone: re-embedding
 * those pages overwrites their points in place (chunk ids are
 * deterministic), so there's nothing to clean up unless the page's
 * content shrank — which the backend handles itself by deleting the
 * page's points when its content hash no longer matches.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const articleId = typeof body?.articleId === "string" && body.articleId ? body.articleId : undefined;
  const alsoDropCollection = body?.dropCollection === true;

  if (!articleId && !alsoDropCollection && body?.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Refusing to reset every article's embedding state without confirm: true (or an articleId).",
      },
      { status: 400 }
    );
  }

  const settings = await getEmbeddingSettings();
  let droppedCollection = false;
  let dropError: string | null = null;

  if (alsoDropCollection) {
    // Vectors first: if this fails, Postgres still points at real data
    // and the reset can be retried. The other order would strand rows
    // claiming "nothing is embedded" while the collection is still full.
    const result = await dropCollection(settings.collection);
    if (result.ok) {
      droppedCollection = true;
    } else {
      dropError = result.error;
      return NextResponse.json(
        {
          error: `Couldn't drop the Qdrant collection, so nothing was reset: ${dropError}`,
        },
        { status: 502 }
      );
    }
  }

  const pagesReset = await resetEmbeddingState(articleId);

  return NextResponse.json({
    ok: true,
    scope: articleId ? "article" : "all",
    articleId: articleId ?? null,
    pagesReset,
    collection: settings.collection,
    droppedCollection,
  });
}
