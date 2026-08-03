import { searchSimilar, type SimilarityHit } from "@/lib/embedding-backend";
import { getEmbeddingSettings } from "@/lib/embedding-settings";

/**
 * Semantic search over the embedded library, shaped for a chat tool.
 *
 * The raw backend response is per-*chunk*: a good query often returns
 * three chunks of the same paper, which reads to a model as three
 * separate sources and encourages it to over-weight one article. So hits
 * are grouped by article here, best-scoring passage first, with the
 * remaining passages attached to the same entry.
 *
 * Errors resolve rather than throw for the same reason the backend client
 * does: a tool result saying "nothing is embedded yet, try the keyword
 * search" is far more useful to the model than a thrown fetch error,
 * which just ends the turn.
 */

export type SemanticPassage = {
  pageNumber: number;
  score: number;
  text: string;
};

export type SemanticArticleMatch = {
  title: string;
  url: string;
  abstract: string;
  bestScore: number;
  passages: SemanticPassage[];
};

export type SemanticSearchResult =
  | { ok: true; query: string; count: number; results: SemanticArticleMatch[] }
  | { ok: false; query: string; error: string; results: [] };

// How many passages of the same article to keep. Enough for the model to
// see a claim in context; not so many that one paper crowds out the rest.
const MAX_PASSAGES_PER_ARTICLE = 3;
// Over-fetch chunks so that after grouping there are still several
// distinct articles to choose from.
const CHUNK_OVERFETCH = 3;

function groupByArticle(hits: SimilarityHit[]): SemanticArticleMatch[] {
  const byArticle = new Map<string, SemanticArticleMatch>();

  for (const hit of hits) {
    const key = hit.articleUrl || hit.articleId;
    const existing = byArticle.get(key);
    const passage: SemanticPassage = {
      pageNumber: hit.pageNumber,
      score: Number(hit.score.toFixed(4)),
      text: hit.text,
    };

    if (!existing) {
      byArticle.set(key, {
        title: hit.title || "Untitled",
        url: hit.articleUrl,
        abstract: hit.abstract,
        bestScore: passage.score,
        passages: [passage],
      });
      continue;
    }
    if (existing.passages.length < MAX_PASSAGES_PER_ARTICLE) {
      existing.passages.push(passage);
    }
    // Hits arrive best-first, so bestScore is already set — but don't
    // assume it, in case the backend's ordering ever changes.
    existing.bestScore = Math.max(existing.bestScore, passage.score);
  }

  return Array.from(byArticle.values()).sort((a, b) => b.bestScore - a.bestScore);
}

export async function semanticSearchLibrary(
  query: string,
  limit = 5
): Promise<SemanticSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, query, error: "A non-empty query is required.", results: [] };
  }

  let collection: string | undefined;
  try {
    collection = (await getEmbeddingSettings()).collection;
  } catch {
    // Settings row unreadable — let the backend fall back to its own
    // configured default rather than failing the tool call outright.
    collection = undefined;
  }

  const response = await searchSimilar({
    query: trimmed,
    limit: Math.min(limit * CHUNK_OVERFETCH, 25),
    collection,
  });

  if (!response.ok) {
    return { ok: false, query: trimmed, error: response.error, results: [] };
  }
  if (!response.data.ok) {
    return {
      ok: false,
      query: trimmed,
      error:
        response.data.error ||
        "Semantic search is unavailable — the library may not have been embedded yet (/make-embedding).",
      results: [],
    };
  }

  const grouped = groupByArticle(response.data.results).slice(0, limit);
  return { ok: true, query: trimmed, count: grouped.length, results: grouped };
}
