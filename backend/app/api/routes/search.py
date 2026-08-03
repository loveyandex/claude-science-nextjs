"""Similarity search over the embedded library.

This is the endpoint the chat agent's `searchLibrarySemantic` tool ends up
calling (via src/lib/qdrant-search.ts). Keeping it here rather than
talking to Qdrant from TypeScript means one embedding model, loaded once,
in the one process that already has it — the query has to be encoded with
the *same* model the chunks were, and duplicating that in a second runtime
is how collections quietly start returning nonsense.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.schemas import SearchHitResponse, SearchRequest, SearchResponse
from app.config import get_settings
from app.core.errors import ServiceError
from app.core.security import require_internal_secret
from app.dependencies import get_search_service
from app.services.search_service import SimilaritySearchService

router = APIRouter(
    prefix="/search",
    tags=["search"],
    dependencies=[Depends(require_internal_secret)],
)


@router.post("/similar", response_model=SearchResponse)
def search_similar(
    body: SearchRequest,
    service: SimilaritySearchService = Depends(get_search_service),
) -> SearchResponse:
    collection = (body.collection or "").strip() or get_settings().embedding_collection
    try:
        hits = service.search(
            query=body.query,
            limit=body.limit,
            collection=collection,
            article_id=body.articleId,
            snippet_chars=body.snippetChars,
        )
    except ServiceError as err:
        # Returned as ok:false rather than a 5xx so the chat tool can hand
        # the model a readable explanation ("nothing is embedded yet")
        # instead of a bare fetch failure.
        return SearchResponse(
            ok=False, query=body.query, collection=collection, count=0, error=str(err)
        )

    return SearchResponse(
        ok=True,
        query=body.query,
        collection=collection,
        count=len(hits),
        results=[SearchHitResponse.from_domain(h) for h in hits],
    )
