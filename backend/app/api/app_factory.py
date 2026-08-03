"""Builds the FastAPI application.

A factory rather than a module-level `app = FastAPI()` so tests can spin
up an isolated instance with overridden dependencies, and so router
registration is one obvious list instead of decorators scattered across
files.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.routes import embedding, gemma, health, search
from app.config import get_settings
from app.core.errors import ConfigurationError, ServiceError, VectorStoreError

API_TITLE = "locaul-science backend"
API_VERSION = "0.5.0"


def _log_startup_banner() -> None:
    settings = get_settings()
    print(f"[backend] {API_TITLE} v{API_VERSION}")
    print(f"[backend] NEXTJS_BASE_URL={settings.nextjs_base_url}")
    print(f"[backend] gemma: model={settings.gemma_model} dpi={settings.pdf_dpi}")
    print(
        f"[backend] embedding: qdrant={settings.qdrant_url} model={settings.embedding_model} "
        f"collection={settings.embedding_collection}"
    )
    if not settings.internal_api_secret:
        print(
            "[backend] WARNING: INTERNAL_API_SECRET is not set — every authenticated route will "
            "reject requests until it matches the Next.js app's value."
        )


def create_app() -> FastAPI:
    _log_startup_banner()

    app = FastAPI(title=API_TITLE, version=API_VERSION)

    # Domain errors become HTTP here, and only here — services stay
    # transport-agnostic.
    @app.exception_handler(ConfigurationError)
    async def _configuration_error(_: Request, exc: ConfigurationError) -> JSONResponse:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

    @app.exception_handler(VectorStoreError)
    async def _vector_store_error(_: Request, exc: VectorStoreError) -> JSONResponse:
        # 502: this service is fine, the vector database it depends on isn't.
        return JSONResponse(status_code=502, content={"ok": False, "error": str(exc)})

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

    for router in (health.router, gemma.router, embedding.router, search.router):
        app.include_router(router)

    return app
