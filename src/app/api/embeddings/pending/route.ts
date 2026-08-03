import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getEmbeddingStats, countPagesNeedingEmbedding } from "@/lib/embedding-repository";
import { getEmbeddingSettings } from "@/lib/embedding-settings";
import { getCollectionInfo, backendBaseUrl } from "@/lib/embedding-backend";

export const dynamic = "force-dynamic";

/**
 * Everything the /make-embedding page needs on load: how much work is
 * outstanding (Postgres), and what the vector collection currently holds
 * (Qdrant, via the Python service).
 *
 * A backend that's down is reported, not thrown: the Postgres half of the
 * picture is still useful, and the page renders a "start the backend"
 * hint rather than an empty error screen.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  try {
    const settings = await getEmbeddingSettings();
    const [stats, pendingPages, collection] = await Promise.all([
      getEmbeddingStats(),
      countPagesNeedingEmbedding("resume"),
      getCollectionInfo(settings.collection),
    ]);

    return NextResponse.json({
      settings,
      stats,
      pendingPages,
      backend: {
        url: backendBaseUrl(),
        reachable: collection.ok,
        error: collection.ok ? null : collection.error,
        collection: collection.ok ? collection.data : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read embedding status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
