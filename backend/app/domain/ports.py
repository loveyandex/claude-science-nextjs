"""The interfaces the service layer depends on (dependency inversion).

`PageEmbeddingService` never imports qdrant_client or httpx — it takes a
`VectorStore` and a `ProgressReporter`. That's what makes it testable
with fakes, and what would let this project move to a different vector
database or report progress over a queue instead of HTTP without the
orchestration logic noticing.
"""

from __future__ import annotations

from typing import Protocol, Sequence, runtime_checkable

from app.domain.models import Chunk, ChunkRecord, CollectionInfo, PageEmbeddingResult, SearchHit


@runtime_checkable
class TokenEstimator(Protocol):
    """Estimates a token count for text without owning a real tokenizer."""

    def count(self, text: str) -> int: ...


@runtime_checkable
class TextChunker(Protocol):
    """Splits a page into deterministic, resumable chunks.

    Determinism is a hard requirement, not a nicety: the same text and
    the same policy must always produce the same chunk at the same index,
    or "resume page 7 from chunk 12" silently embeds the wrong thing.
    """

    def chunk(self, text: str) -> list[Chunk]: ...


@runtime_checkable
class VectorStore(Protocol):
    def ensure_collection(self, collection: str) -> None: ...

    def upsert_chunks(self, collection: str, records: Sequence[ChunkRecord]) -> int: ...

    def delete_page_points(self, collection: str, page_id: str) -> None: ...

    def search(
        self,
        collection: str,
        query_text: str,
        limit: int,
        article_id: str | None = None,
    ) -> list[SearchHit]: ...

    def collection_info(self, collection: str) -> CollectionInfo: ...

    def drop_collection(self, collection: str) -> None: ...


@runtime_checkable
class ProgressReporter(Protocol):
    """Receives per-page progress while a batch is still running.

    Implementations must be non-fatal: a reporter that can't deliver
    should log and return, never abort the embedding run — losing a
    progress ping is recoverable, losing embedded work is not.
    """

    def report(self, result: PageEmbeddingResult) -> None: ...
