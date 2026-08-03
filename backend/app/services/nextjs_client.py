"""Outbound calls back into the Next.js app.

The Next.js app owns Postgres — this service never opens a database
connection of its own. Both pipelines therefore push their results back
over HTTP: transcribed pages to `/api/articles-gemma4/ingest-page`, and
embedding progress to `/api/embeddings/ingest-progress`. Keeping exactly
one writer for the database is what lets the browser watch a run's
progress by reading Postgres, with no second channel out of here.
"""

from __future__ import annotations

import httpx

from app.core.errors import UpstreamError
from app.domain.models import PageEmbeddingResult
from app.domain.ports import ProgressReporter


class NextJsClient:
    """Thin, explicit HTTP client. Not a generic wrapper — one method per
    call this service actually makes, so the contract is readable here."""

    def __init__(self, base_url: str, internal_secret: str, timeout_seconds: float = 30.0):
        self._base_url = base_url.rstrip("/")
        self._secret = internal_secret
        self._timeout = timeout_seconds

    def _headers(self) -> dict[str, str]:
        return {"X-Internal-Secret": self._secret, "Content-Type": "application/json"}

    def push_page_markdown(
        self,
        client: httpx.Client,
        url: str,
        page_number: int,
        page_count: int,
        content: str,
    ) -> None:
        res = client.post(
            f"{self._base_url}/api/articles-gemma4/ingest-page",
            json={"url": url, "pageNumber": page_number, "pageCount": page_count, "content": content},
            headers=self._headers(),
            timeout=self._timeout,
        )
        res.raise_for_status()

    def push_embedding_progress(self, payload: dict) -> None:
        try:
            res = httpx.post(
                f"{self._base_url}/api/embeddings/ingest-progress",
                json=payload,
                headers=self._headers(),
                timeout=self._timeout,
            )
            res.raise_for_status()
        except Exception as err:  # noqa: BLE001
            raise UpstreamError(f"Reporting embedding progress to Next.js failed: {err}") from err


class HttpProgressReporter(ProgressReporter):
    """`ProgressReporter` that persists progress by calling Next.js.

    Failures here are logged and swallowed on purpose. A dropped progress
    ping costs the UI one stale second; letting it propagate would abort
    a run whose vectors are already safely in Qdrant.
    """

    def __init__(self, client: NextJsClient):
        self._client = client

    def report(self, result: PageEmbeddingResult) -> None:
        payload = {
            "pageId": result.page_id,
            "articleId": result.article_id,
            "pageNumber": result.page_number,
            "status": result.status.value,
            "chunkCount": result.chunk_count,
            "embeddedChunks": result.embedded_chunks,
            "contentHash": result.content_hash,
            "model": result.model,
            "error": result.error,
        }
        try:
            self._client.push_embedding_progress(payload)
        except UpstreamError as err:
            print(f"[embedding] progress ping dropped for page {result.page_id}: {err}")


class NullProgressReporter(ProgressReporter):
    """Used when a caller asks for a dry run, and in tests."""

    def report(self, result: PageEmbeddingResult) -> None:  # noqa: D102
        return None
