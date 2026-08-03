"""Page -> chunks -> vectors, resumably.

This is the heart of the /make-embedding pipeline and the only place that
knows the *rules* of embedding a page:

- A page is chunked deterministically, so chunk index N always means the
  same slice of text (see `chunking.py`).
- The content hash covers both the text and the chunking policy. If it
  doesn't match what the database recorded, the page is re-embedded from
  chunk 0 and its stale vectors are deleted first — a re-transcribed page
  or a changed chunk size can't leave ghosts behind.
- Otherwise the page resumes at `start_chunk`: already-embedded chunks
  are never re-encoded, which is what makes a stopped run cheap to pick
  back up.
- Progress is reported per upsert batch, not per page, so the browser
  sees "page 12: 3/9 chunks" while a long page is still in flight.
- One page's failure is that page's failure. The batch keeps going and
  the page comes back as `failed` with its reason attached.

It depends only on the ports in `app.domain.ports`, so it can be driven
with a fake store and a fake reporter in a test with no Qdrant running.
"""

from __future__ import annotations

import hashlib
from typing import Callable, Iterable, Sequence

from app.core.errors import ServiceError
from app.domain.models import (
    Chunk,
    ChunkingPolicy,
    ChunkRecord,
    EmbeddingStatus,
    PageEmbeddingResult,
    PageToEmbed,
)
from app.domain.identity import build_point_id
from app.domain.ports import ProgressReporter, TextChunker, VectorStore

# Abstracts get copied into every chunk's payload so a search hit can be
# rendered (title + abstract + snippet) without a second database read.
# Capped so one long abstract can't bloat every point in the collection.
MAX_ABSTRACT_IN_PAYLOAD = 600


def compute_content_hash(content: str, policy: ChunkingPolicy, model: str) -> str:
    """Identity of "this text, split this way, by this model".

    The model is part of it because vectors from a different model aren't
    interchangeable — switching models has to invalidate existing work
    just as surely as changing the chunk size does.
    """
    digest = hashlib.sha256()
    digest.update(policy.fingerprint().encode("utf-8"))
    digest.update(b"|")
    digest.update(model.encode("utf-8"))
    digest.update(b"|")
    digest.update(content.encode("utf-8"))
    return digest.hexdigest()


class PageEmbeddingService:
    def __init__(
        self,
        store: VectorStore,
        chunker_factory: Callable[[ChunkingPolicy], TextChunker],
        reporter: ProgressReporter,
        model_name: str,
        upsert_batch: int = 32,
    ):
        self._store = store
        self._chunker_factory = chunker_factory
        self._reporter = reporter
        self._model_name = model_name
        self._upsert_batch = max(1, upsert_batch)

    # --- public API -------------------------------------------------------

    def plan(self, pages: Sequence[PageToEmbed], policy: ChunkingPolicy) -> list[PageEmbeddingResult]:
        """Chunk without embedding — lets the UI show "this run is N
        chunks of work" before committing to it, and lets the caller
        detect content drift cheaply."""
        chunker = self._chunker_factory(policy)
        results: list[PageEmbeddingResult] = []
        for page in pages:
            chunks = chunker.chunk(page.content)
            content_hash = compute_content_hash(page.content, policy, self._model_name)
            resume_at = self._resume_index(page, content_hash, len(chunks))
            results.append(
                PageEmbeddingResult(
                    page_id=page.page_id,
                    article_id=page.article_id,
                    page_number=page.page_number,
                    status=EmbeddingStatus.EMBEDDED if resume_at >= len(chunks) and chunks else EmbeddingStatus.PENDING,
                    chunk_count=len(chunks),
                    embedded_chunks=resume_at,
                    content_hash=content_hash,
                    model=self._model_name,
                    restarted=resume_at == 0 and page.start_chunk > 0,
                )
            )
        return results

    def embed_pages(
        self,
        collection: str,
        pages: Sequence[PageToEmbed],
        policy: ChunkingPolicy,
    ) -> list[PageEmbeddingResult]:
        chunker = self._chunker_factory(policy)
        self._store.ensure_collection(collection)

        results: list[PageEmbeddingResult] = []
        for page in pages:
            results.append(self._embed_one_page(collection, page, chunker, policy))
        return results

    # --- internals --------------------------------------------------------

    def _embed_one_page(
        self,
        collection: str,
        page: PageToEmbed,
        chunker: TextChunker,
        policy: ChunkingPolicy,
    ) -> PageEmbeddingResult:
        content_hash = compute_content_hash(page.content, policy, self._model_name)

        def make_result(
            status: EmbeddingStatus,
            chunk_count: int,
            embedded: int,
            *,
            restarted: bool = False,
            skipped: bool = False,
            error: str | None = None,
        ) -> PageEmbeddingResult:
            return PageEmbeddingResult(
                page_id=page.page_id,
                article_id=page.article_id,
                page_number=page.page_number,
                status=status,
                chunk_count=chunk_count,
                embedded_chunks=embedded,
                content_hash=content_hash,
                model=self._model_name,
                restarted=restarted,
                skipped=skipped,
                error=error,
            )

        try:
            chunks = chunker.chunk(page.content)
        except Exception as err:  # noqa: BLE001
            result = make_result(EmbeddingStatus.FAILED, 0, 0, error=f"Chunking failed: {err}")
            self._reporter.report(result)
            return result

        if not chunks:
            # An empty page still counts as "done" — otherwise it'd be
            # picked up as pending work forever, every single run.
            result = make_result(EmbeddingStatus.EMBEDDED, 0, 0, skipped=True)
            self._reporter.report(result)
            return result

        stale = page.known_content_hash is not None and page.known_content_hash != content_hash
        resume_at = self._resume_index(page, content_hash, len(chunks))

        if stale:
            try:
                self._store.delete_page_points(collection, page.page_id)
            except ServiceError as err:
                result = make_result(EmbeddingStatus.FAILED, len(chunks), 0, error=str(err))
                self._reporter.report(result)
                return result

        if resume_at >= len(chunks):
            result = make_result(EmbeddingStatus.EMBEDDED, len(chunks), len(chunks), skipped=True)
            self._reporter.report(result)
            return result

        embedded = resume_at
        for batch in self._batched(chunks[resume_at:], self._upsert_batch):
            records = [self._to_record(page, chunk) for chunk in batch]
            try:
                self._store.upsert_chunks(collection, records)
            except ServiceError as err:
                result = make_result(
                    EmbeddingStatus.PARTIAL if embedded > 0 else EmbeddingStatus.FAILED,
                    len(chunks),
                    embedded,
                    restarted=stale,
                    error=str(err),
                )
                self._reporter.report(result)
                return result

            embedded += len(records)
            if embedded < len(chunks):
                # Mid-page heartbeat: persists the resume cursor as it
                # advances, so even a hard crash resumes from the last
                # completed batch rather than the start of the page.
                self._reporter.report(
                    make_result(EmbeddingStatus.PARTIAL, len(chunks), embedded, restarted=stale)
                )

        result = make_result(EmbeddingStatus.EMBEDDED, len(chunks), embedded, restarted=stale)
        self._reporter.report(result)
        return result

    def _resume_index(self, page: PageToEmbed, content_hash: str, chunk_count: int) -> int:
        """Where this page should start. Zero unless the database's view
        of the content still matches what we just chunked."""
        if page.known_content_hash is None or page.known_content_hash != content_hash:
            return 0
        return max(0, min(page.start_chunk, chunk_count))

    def _to_record(self, page: PageToEmbed, chunk: Chunk) -> ChunkRecord:
        return ChunkRecord(
            point_id=build_point_id(page.page_id, chunk.index),
            text=chunk.text,
            payload={
                "article_id": page.article_id,
                "article_url": page.article_url,
                "page_id": page.page_id,
                "page_number": page.page_number,
                "chunk_index": chunk.index,
                "title": page.title or "Untitled",
                "abstract": (page.abstract or "")[:MAX_ABSTRACT_IN_PAYLOAD],
            },
        )

    @staticmethod
    def _batched(items: Sequence[Chunk], size: int) -> Iterable[Sequence[Chunk]]:
        for start in range(0, len(items), size):
            yield items[start : start + size]
