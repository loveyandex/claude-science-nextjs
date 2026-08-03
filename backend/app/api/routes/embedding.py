"""make-embedding endpoints — chunk pages and push them into Qdrant.

The unit of work is a *batch of pages*, not a whole article or a whole
run. That's deliberate: it keeps this service stateless (all resume state
lives in Postgres, which Next.js owns), and it gives the orchestrator a
natural stop point — to stop a run it simply stops sending batches, and
whatever has already been embedded stays embedded.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.schemas import (
    CollectionInfoResponse,
    DropCollectionRequest,
    EmbedPagesRequest,
    EmbedPagesResponse,
    PageResultResponse,
)
from app.config import get_settings
from app.core.errors import ServiceError
from app.core.security import require_internal_secret
from app.dependencies import get_dry_run_embedding_service, get_embedding_service, get_vector_store
from app.services.embedding_service import PageEmbeddingService
from app.services.vector_store import QdrantVectorStore

router = APIRouter(
    prefix="/embedding",
    tags=["embedding"],
    dependencies=[Depends(require_internal_secret)],
)


def _resolve_collection(requested: str | None) -> str:
    return (requested or "").strip() or get_settings().embedding_collection


# Defined with `def`, not `async def`, on purpose: embedding is CPU-bound
# (FastEmbed runs the model in-process), so FastAPI runs this in its
# threadpool and one long batch can't stall the event loop for /health or
# a concurrent gemma4 call.
@router.post("/embed-pages", response_model=EmbedPagesResponse)
def embed_pages(
    body: EmbedPagesRequest,
    service: PageEmbeddingService = Depends(get_embedding_service),
) -> EmbedPagesResponse:
    collection = _resolve_collection(body.collection)
    settings = get_settings()

    if not body.pages:
        return EmbedPagesResponse(ok=True, collection=collection, model=settings.embedding_model)

    try:
        results = service.embed_pages(
            collection=collection,
            pages=[p.to_domain() for p in body.pages],
            policy=body.chunking.to_domain(),
        )
    except ServiceError as err:
        # A failure at this level is environmental (Qdrant unreachable,
        # model won't load) rather than page-specific — the orchestrator
        # treats it as "stop the run", not "skip this page".
        return EmbedPagesResponse(
            ok=False, collection=collection, model=settings.embedding_model, error=str(err)
        )

    return EmbedPagesResponse(
        ok=True,
        collection=collection,
        model=settings.embedding_model,
        results=[PageResultResponse.from_domain(r) for r in results],
        totalChunksEmbedded=sum(r.embedded_chunks for r in results),
    )


@router.post("/plan", response_model=EmbedPagesResponse)
def plan_pages(
    body: EmbedPagesRequest,
    service: PageEmbeddingService = Depends(get_dry_run_embedding_service),
) -> EmbedPagesResponse:
    """Chunk-count a batch without writing anything. Lets the UI show the
    real size of a run (and detect content drift) before starting it."""
    collection = _resolve_collection(body.collection)
    settings = get_settings()
    results = service.plan([p.to_domain() for p in body.pages], body.chunking.to_domain())
    return EmbedPagesResponse(
        ok=True,
        collection=collection,
        model=settings.embedding_model,
        results=[PageResultResponse.from_domain(r) for r in results],
        totalChunksEmbedded=0,
    )


@router.get("/collection", response_model=CollectionInfoResponse)
def collection_info(
    collection: str | None = None,
    store: QdrantVectorStore = Depends(get_vector_store),
) -> CollectionInfoResponse:
    name = _resolve_collection(collection)
    info = store.collection_info(name)
    return CollectionInfoResponse(
        name=info.name,
        exists=info.exists,
        pointsCount=info.points_count,
        vectorsCount=info.vectors_count,
        status=info.status,
        model=store.model_name,
    )


@router.post("/collection/drop")
def drop_collection(
    body: DropCollectionRequest,
    store: QdrantVectorStore = Depends(get_vector_store),
) -> dict:
    """Deletes the whole collection. The caller is responsible for also
    resetting Postgres's per-page embedding state — /api/embeddings/reset
    on the Next.js side does both together, and is the intended entry
    point for a full re-embed."""
    if not body.confirm:
        return {"ok": False, "error": "Refusing to drop a collection without confirm: true."}
    name = _resolve_collection(body.collection)
    store.drop_collection(name)
    return {"ok": True, "collection": name, "dropped": True}
