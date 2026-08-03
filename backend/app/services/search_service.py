"""Similarity search over the embedded library.

Kept separate from the embedding service on purpose: reading and writing
the collection are different responsibilities with different callers (the
chat agent's tool call vs. the indexing pipeline) and very different
failure modes. They share the `VectorStore` port and nothing else.
"""

from __future__ import annotations

from app.core.errors import VectorStoreError
from app.domain.models import SearchHit

# Long page-chunks make a chat tool result huge for little benefit — the
# agent needs enough to judge relevance and quote from, not the whole page
# (that's what getArticleFullContent is for).
DEFAULT_SNIPPET_CHARS = 1200


class SimilaritySearchService:
    def __init__(self, store, collection: str, snippet_chars: int = DEFAULT_SNIPPET_CHARS):
        self._store = store
        self._default_collection = collection
        self._snippet_chars = snippet_chars

    def search(
        self,
        query: str,
        limit: int = 5,
        collection: str | None = None,
        article_id: str | None = None,
        snippet_chars: int | None = None,
    ) -> list[SearchHit]:
        query = (query or "").strip()
        if not query:
            raise VectorStoreError("A non-empty query is required.")

        hits = self._store.search(
            collection=collection or self._default_collection,
            query_text=query,
            limit=max(1, min(limit, 25)),
            article_id=article_id,
        )
        cap = snippet_chars or self._snippet_chars
        return [self._truncate(hit, cap) for hit in hits]

    @staticmethod
    def _truncate(hit: SearchHit, cap: int) -> SearchHit:
        if len(hit.text) <= cap:
            return hit
        return SearchHit(
            score=hit.score,
            article_id=hit.article_id,
            article_url=hit.article_url,
            page_id=hit.page_id,
            page_number=hit.page_number,
            chunk_index=hit.chunk_index,
            title=hit.title,
            abstract=hit.abstract,
            text=hit.text[:cap].rstrip() + "…",
        )
