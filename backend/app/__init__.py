"""locaul-science Python service.

Two pipelines live behind one process, kept separate all the way down:

- **make-science-gemma4** (`/index-article`) — renders PDF pages to images
  and transcribes them with a vision model.
- **make-embedding** (`/embedding/*`, `/search/*`) — chunks the resulting
  markdown and embeds it into Qdrant with FastEmbed, then serves
  similarity search over it.

Layering, outermost first:

    api/         FastAPI routers + pydantic wire schemas. HTTP lives here.
    dependencies composition root — picks the concrete implementations.
    services/    the actual behaviour; depends only on domain/ports.
    domain/      plain dataclasses + Protocols, no third-party imports.
    core/        cross-cutting bits (auth, error types).
    config       one typed view of the environment.

Nothing in `services/` imports FastAPI, and nothing in `domain/` imports
anything at all — which is what keeps the pipelines testable without a
running Qdrant, Postgres, or model provider.

This module is intentionally empty of imports: pulling `create_app` in
here would mean `import app.domain.models` transitively loads FastAPI and
qdrant_client, which defeats exactly the property described above. The
entrypoint imports `app.api.app_factory` directly instead.
"""

