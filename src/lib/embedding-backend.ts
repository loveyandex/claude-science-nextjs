/**
 * Typed client for the Python service's embedding + search endpoints.
 *
 * Nothing else in the Next.js app speaks to Qdrant, and nothing here
 * knows anything about Prisma — this module is purely the boundary
 * between the two processes. The reason the vector database is reached
 * through Python at all (rather than @qdrant/js-client-rest directly) is
 * that queries have to be encoded with the *same* embedding model the
 * chunks were, and that model is loaded, once, over there.
 *
 * Every method resolves rather than throws: callers are a streaming
 * indexing route and a chat tool, and both need to report a readable
 * reason instead of surfacing a raw fetch rejection.
 */

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

// Embedding a batch of pages is genuinely slow the first time (FastEmbed
// downloads and loads the model before it encodes anything), so this is
// far more generous than the gemma4 client's timeout.
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const QUICK_TIMEOUT_MS = 30 * 1000;

export type BackendOk<T> = { ok: true; data: T };
export type BackendErr = { ok: false; error: string; status?: number };
export type BackendResult<T> = BackendOk<T> | BackendErr;

export type PageToEmbed = {
  pageId: string;
  articleId: string;
  articleUrl: string;
  pageNumber: number;
  content: string;
  title: string;
  abstract: string;
  startChunk: number;
  contentHash: string | null;
};

export type ChunkingPolicy = {
  maxTokens: number;
  overlapTokens: number;
  minTokens?: number;
};

export type PageEmbeddingResult = {
  pageId: string;
  articleId: string;
  pageNumber: number;
  status: "pending" | "partial" | "embedded" | "failed";
  chunkCount: number;
  embeddedChunks: number;
  contentHash: string;
  model: string;
  restarted: boolean;
  skipped: boolean;
  error: string | null;
};

export type EmbedPagesResponse = {
  ok: boolean;
  collection: string;
  model: string;
  results: PageEmbeddingResult[];
  totalChunksEmbedded: number;
  error?: string | null;
};

export type CollectionInfo = {
  name: string;
  exists: boolean;
  pointsCount: number;
  vectorsCount: number;
  status: string;
  model: string;
};

export type SimilarityHit = {
  score: number;
  articleId: string;
  articleUrl: string;
  pageId: string;
  pageNumber: number;
  chunkIndex: number;
  title: string;
  abstract: string;
  text: string;
};

export type SimilarityResponse = {
  ok: boolean;
  query: string;
  collection: string;
  count: number;
  results: SimilarityHit[];
  error?: string | null;
};

export function isBackendConfigured(): boolean {
  return Boolean(INTERNAL_API_SECRET);
}

export function backendBaseUrl(): string {
  return BACKEND_URL;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number; signal?: AbortSignal }
): Promise<BackendResult<T>> {
  if (!INTERNAL_API_SECRET) {
    return {
      ok: false,
      error:
        "INTERNAL_API_SECRET is not configured — set it in .env (the same value backend/.env uses).",
    };
  }

  // Two independent reasons to give up: our own timeout, and the caller
  // aborting (the browser closing an indexing stream). AbortSignal.any
  // isn't available on every supported runtime, so they're combined by
  // hand into one controller.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onCallerAbort);

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_API_SECRET,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      // FastAPI's error handlers return {ok:false,error} for domain
      // failures; anything else (a 422, a proxy error page) falls back to
      // the status line so the message is still actionable.
      const detail = await res.text().catch(() => "");
      let message = `${res.status} ${res.statusText}`;
      try {
        const parsed = JSON.parse(detail);
        message = parsed?.error || parsed?.detail || message;
      } catch {
        if (detail) message = `${message}: ${detail.slice(0, 300)}`;
      }
      return { ok: false, error: message, status: res.status };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    if (init.signal?.aborted) {
      return { ok: false, error: "Cancelled." };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `The embedding backend didn't respond in time (${BACKEND_URL}).` };
    }
    const reason = err instanceof Error ? err.message : "Unknown network error";
    return {
      ok: false,
      error: `Couldn't reach the embedding backend at ${BACKEND_URL} — is it running (see backend/README.md)? ${reason}`,
    };
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export function embedPages(
  args: {
    pages: PageToEmbed[];
    collection: string;
    chunking: ChunkingPolicy;
  },
  signal?: AbortSignal
): Promise<BackendResult<EmbedPagesResponse>> {
  return call<EmbedPagesResponse>("/embedding/embed-pages", {
    method: "POST",
    body: { pages: args.pages, collection: args.collection, chunking: args.chunking },
    signal,
  });
}

export function getCollectionInfo(collection: string): Promise<BackendResult<CollectionInfo>> {
  return call<CollectionInfo>(`/embedding/collection?collection=${encodeURIComponent(collection)}`, {
    method: "GET",
    timeoutMs: QUICK_TIMEOUT_MS,
  });
}

export function dropCollection(collection: string): Promise<BackendResult<{ ok: boolean }>> {
  return call<{ ok: boolean }>("/embedding/collection/drop", {
    method: "POST",
    body: { collection, confirm: true },
    timeoutMs: QUICK_TIMEOUT_MS,
  });
}

export function searchSimilar(args: {
  query: string;
  limit?: number;
  collection?: string;
  articleId?: string;
  snippetChars?: number;
}): Promise<BackendResult<SimilarityResponse>> {
  return call<SimilarityResponse>("/search/similar", {
    method: "POST",
    body: {
      query: args.query,
      limit: args.limit ?? 5,
      collection: args.collection,
      articleId: args.articleId,
      snippetChars: args.snippetChars,
    },
    // A chat tool call is in the user's critical path — fail fast and let
    // the model fall back to keyword search rather than hanging the turn.
    timeoutMs: 60_000,
  });
}
