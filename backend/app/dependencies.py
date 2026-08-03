"""Composition root.

Every concrete class is chosen exactly once, here, and handed to routers
through FastAPI's `Depends`. Routers therefore import interfaces and
services but never construct adapters — which is what lets a test
override a single dependency instead of monkey-patching module globals.

The expensive singletons (the Qdrant client, and through it the FastEmbed
model) are `@lru_cache`d: loading the embedding model takes seconds and
hundreds of MB, so it must happen once per process, not once per request.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_settings
from app.services.article_indexer import ArticleIndexingService, PdfPageRenderer
from app.services.chunking import build_chunker
from app.services.embedding_service import PageEmbeddingService
from app.services.nextjs_client import HttpProgressReporter, NextJsClient, NullProgressReporter
from app.services.search_service import SimilaritySearchService
from app.services.vector_store import QdrantVectorStore


@lru_cache(maxsize=1)
def get_nextjs_client() -> NextJsClient:
    settings: Settings = get_settings()
    return NextJsClient(settings.nextjs_base_url, settings.internal_api_secret)


@lru_cache(maxsize=1)
def get_vector_store() -> QdrantVectorStore:
    settings = get_settings()
    return QdrantVectorStore(
        url=settings.qdrant_url,
        model_name=settings.embedding_model,
        api_key=settings.qdrant_api_key,
        timeout_seconds=settings.qdrant_timeout_seconds,
        parallel=settings.embedding_parallel,
    )


def get_embedding_service() -> PageEmbeddingService:
    settings = get_settings()
    return PageEmbeddingService(
        store=get_vector_store(),
        chunker_factory=build_chunker,
        reporter=HttpProgressReporter(get_nextjs_client()),
        model_name=settings.embedding_model,
        upsert_batch=settings.embedding_upsert_batch,
    )


def get_dry_run_embedding_service() -> PageEmbeddingService:
    """Same service, wired to report nowhere — used by /embedding/plan."""
    settings = get_settings()
    return PageEmbeddingService(
        store=get_vector_store(),
        chunker_factory=build_chunker,
        reporter=NullProgressReporter(),
        model_name=settings.embedding_model,
        upsert_batch=settings.embedding_upsert_batch,
    )


def get_search_service() -> SimilaritySearchService:
    settings = get_settings()
    return SimilaritySearchService(get_vector_store(), settings.embedding_collection)


@lru_cache(maxsize=1)
def get_article_indexing_service() -> ArticleIndexingService:
    settings = get_settings()
    return ArticleIndexingService(
        renderer=PdfPageRenderer(settings.pdf_dpi, settings.poppler_path),
        nextjs=get_nextjs_client(),
        gemma_model=settings.gemma_model,
    )
