"""make-science-gemma4 endpoints.

`POST /index-article` keeps its original path (no prefix) — the Next.js
orchestrator at /api/articles-gemma4/index calls it by that exact URL,
and this refactor isn't the place to break that contract.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.schemas import IndexArticleRequest
from app.config import get_settings
from app.core.security import require_internal_secret
from app.dependencies import get_article_indexing_service
from app.services.article_indexer import ArticleIndexingService

router = APIRouter(tags=["gemma4"], dependencies=[Depends(require_internal_secret)])


@router.post("/index-article")
def index_article(
    body: IndexArticleRequest,
    service: ArticleIndexingService = Depends(get_article_indexing_service),
) -> dict:
    settings = get_settings()
    keys = [k for k in body.cerebrasApiKeys if k]
    if not keys and settings.fallback_cerebras_api_key:
        keys = [settings.fallback_cerebras_api_key]
    if not keys:
        return {
            "ok": False,
            "error": (
                "No Cerebras API key available — add one at /settings, or set CEREBRAS_API_KEY "
                "in backend/.env as a fallback."
            ),
        }

    outcome = service.index_article(
        url=body.url,
        pdf_url=body.pdfUrl,
        skip_pages=body.skipPages,
        api_keys=keys,
    )
    return outcome.to_response()
