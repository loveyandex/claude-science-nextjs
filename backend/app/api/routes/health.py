"""Liveness and configuration introspection. No auth — nothing secret
is returned, only whether each dependency is configured, so this stays
usable as a plain container/uptime probe."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/health/config")
def health_config() -> dict:
    """What this process thinks it's configured to do. Deliberately
    reports booleans and non-secret values only."""
    settings = get_settings()
    return {
        "ok": True,
        "internalSecretConfigured": bool(settings.internal_api_secret),
        "nextjsBaseUrl": settings.nextjs_base_url,
        "gemma": {
            "model": settings.gemma_model,
            "pdfDpi": settings.pdf_dpi,
            "popplerPathConfigured": bool(settings.poppler_path),
            "fallbackKeyConfigured": bool(settings.fallback_cerebras_api_key),
        },
        "embedding": {
            "qdrantUrl": settings.qdrant_url,
            "qdrantApiKeyConfigured": bool(settings.qdrant_api_key),
            "model": settings.embedding_model,
            "defaultCollection": settings.embedding_collection,
            "upsertBatch": settings.embedding_upsert_batch,
            "parallel": settings.embedding_parallel,
        },
    }
