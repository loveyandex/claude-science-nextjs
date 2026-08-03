"""Qdrant + FastEmbed adapter — the only module that imports qdrant_client.

Embedding runs locally through FastEmbed (no embedding API key, no
per-token cost): `QdrantClient.set_model()` registers the model, then
`add()`/`query()` encode text on the way in and out. Everything above
this file talks to the `VectorStore` port instead, so the choice of
Qdrant is a swappable detail rather than an assumption baked through the
codebase.
"""

from __future__ import annotations

import threading
from typing import Sequence

from qdrant_client import QdrantClient, models

from app.core.errors import VectorStoreError
from app.domain.identity import build_point_id  # re-exported for convenience  # noqa: F401
from app.domain.models import ChunkRecord, CollectionInfo, SearchHit

# Payload fields we filter on. Qdrant can filter without an index, but it
# falls back to a full scan, which gets slow well before a library of
# scientific PDFs is "big".
_INDEXED_PAYLOAD_FIELDS = ("article_id", "page_id", "article_url")


class QdrantVectorStore:
    """Concrete `VectorStore`. Safe to share across request threads: the
    client itself is thread-safe, and the one non-reentrant step (model
    registration + collection creation) is done once under a lock."""

    def __init__(
        self,
        url: str,
        model_name: str,
        api_key: str | None = None,
        timeout_seconds: int = 120,
        parallel: int = 1,
    ):
        if not url:
            raise VectorStoreError("QDRANT_URL is not configured — set it in backend/.env.")
        self._url = url
        self._model_name = model_name
        self._api_key = api_key
        self._timeout = timeout_seconds
        self._parallel = max(1, parallel)
        self._client: QdrantClient | None = None
        self._ready_collections: set[str] = set()
        self._lock = threading.Lock()

    # --- lifecycle --------------------------------------------------------

    @property
    def model_name(self) -> str:
        return self._model_name

    def _get_client(self) -> QdrantClient:
        if self._client is not None:
            return self._client
        with self._lock:
            if self._client is None:
                try:
                    client = QdrantClient(url=self._url, api_key=self._api_key, timeout=self._timeout)
                    # Registers the local FastEmbed model on this client —
                    # required before add()/query() can take raw text.
                    client.set_model(self._model_name)
                except Exception as err:  # noqa: BLE001 — surfaced as a domain error
                    raise VectorStoreError(
                        f"Couldn't connect to Qdrant at {self._url} with model "
                        f"'{self._model_name}': {err}"
                    ) from err
                self._client = client
        return self._client

    def ensure_collection(self, collection: str) -> None:
        if collection in self._ready_collections:
            return
        client = self._get_client()
        with self._lock:
            if collection in self._ready_collections:
                return
            try:
                if not client.collection_exists(collection):
                    client.create_collection(
                        collection_name=collection,
                        # Dimensions/distance come from the registered model
                        # rather than being hard-coded, so switching models
                        # doesn't silently create a mismatched collection.
                        vectors_config=client.get_fastembed_vector_params(on_disk=True),
                    )
                    print(f"[qdrant] Created collection '{collection}' for model {self._model_name}")
                for field in _INDEXED_PAYLOAD_FIELDS:
                    try:
                        client.create_payload_index(
                            collection_name=collection,
                            field_name=field,
                            field_schema=models.PayloadSchemaType.KEYWORD,
                        )
                    except Exception:  # noqa: BLE001 — already-indexed is the common case
                        pass
                self._ready_collections.add(collection)
            except VectorStoreError:
                raise
            except Exception as err:  # noqa: BLE001
                raise VectorStoreError(f"Preparing collection '{collection}' failed: {err}") from err

    # --- writes -----------------------------------------------------------

    def upsert_chunks(self, collection: str, records: Sequence[ChunkRecord]) -> int:
        if not records:
            return 0
        self.ensure_collection(collection)
        client = self._get_client()
        try:
            client.add(
                collection_name=collection,
                documents=[r.text for r in records],
                metadata=[r.payload for r in records],
                ids=[r.point_id for r in records],
                parallel=self._parallel,
            )
        except Exception as err:  # noqa: BLE001
            raise VectorStoreError(f"Upserting {len(records)} chunk(s) failed: {err}") from err
        return len(records)

    def delete_page_points(self, collection: str, page_id: str) -> None:
        """Drops every vector belonging to one page. Used when a page's
        content changed under us — stale chunks from the previous version
        would otherwise linger and keep matching searches forever."""
        client = self._get_client()
        if not client.collection_exists(collection):
            return
        try:
            client.delete(
                collection_name=collection,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[models.FieldCondition(key="page_id", match=models.MatchValue(value=page_id))]
                    )
                ),
                wait=True,
            )
        except Exception as err:  # noqa: BLE001
            raise VectorStoreError(f"Deleting stale points for page {page_id} failed: {err}") from err

    def drop_collection(self, collection: str) -> None:
        client = self._get_client()
        try:
            if client.collection_exists(collection):
                client.delete_collection(collection)
        except Exception as err:  # noqa: BLE001
            raise VectorStoreError(f"Dropping collection '{collection}' failed: {err}") from err
        finally:
            self._ready_collections.discard(collection)

    # --- reads ------------------------------------------------------------

    def search(
        self,
        collection: str,
        query_text: str,
        limit: int,
        article_id: str | None = None,
    ) -> list[SearchHit]:
        client = self._get_client()
        if not client.collection_exists(collection):
            raise VectorStoreError(
                f"Collection '{collection}' doesn't exist yet — run the /make-embedding "
                f"pipeline before searching."
            )
        query_filter = None
        if article_id:
            query_filter = models.Filter(
                must=[models.FieldCondition(key="article_id", match=models.MatchValue(value=article_id))]
            )
        try:
            hits = client.query(
                collection_name=collection,
                query_text=query_text,
                query_filter=query_filter,
                limit=limit,
            )
        except Exception as err:  # noqa: BLE001
            raise VectorStoreError(f"Similarity search failed: {err}") from err

        results: list[SearchHit] = []
        for hit in hits:
            payload = hit.metadata or {}
            results.append(
                SearchHit(
                    score=float(hit.score),
                    article_id=str(payload.get("article_id", "")),
                    article_url=str(payload.get("article_url", "")),
                    page_id=str(payload.get("page_id", "")),
                    page_number=int(payload.get("page_number", 0) or 0),
                    chunk_index=int(payload.get("chunk_index", 0) or 0),
                    title=str(payload.get("title", "") or ""),
                    abstract=str(payload.get("abstract", "") or ""),
                    text=str(getattr(hit, "document", None) or payload.get("document", "") or ""),
                )
            )
        return results

    def collection_info(self, collection: str) -> CollectionInfo:
        client = self._get_client()
        try:
            if not client.collection_exists(collection):
                return CollectionInfo(name=collection, exists=False)
            info = client.get_collection(collection)
        except Exception as err:  # noqa: BLE001
            raise VectorStoreError(f"Reading collection '{collection}' failed: {err}") from err
        return CollectionInfo(
            name=collection,
            exists=True,
            points_count=int(info.points_count or 0),
            vectors_count=int(getattr(info, "vectors_count", None) or info.points_count or 0),
            status=str(getattr(info.status, "value", info.status)),
        )
