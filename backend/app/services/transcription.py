"""Cerebras vision transcription of a single rendered PDF page.

Extracted unchanged in behaviour from the original single-file backend —
this is the "one page in, markdown out" step, with its own retry policy,
and nothing about PDFs, batching, or Postgres. The key-pool semantics it
implements are deliberate and documented in backend/README.md:

- 5xx is treated as page-specific and transient: retry, then give up on
  *that page* and let the article continue.
- 429 means *that key* is out of budget right now: retry, then disable the
  key for the rest of the run so other keys keep working and pages already
  assigned to it fail fast instead of burning more retries.
"""

from __future__ import annotations

import base64
import threading
import time

from cerebras.cloud.sdk import Cerebras

from app.core.errors import RateLimitedError
from app.core.security import mask_secret

MAX_RETRIES_PER_PAGE = 3
RATE_LIMIT_BACKOFF_SECONDS = 20
SERVER_ERROR_BACKOFF_SECONDS = 5

TRANSCRIPTION_PROMPT = (
    "Transcribe everything on this page (text, tables, figure captions, equations) as clean "
    "markdown. Output only the markdown, nothing else."
)


class DisabledKeyRegistry:
    """Keys rate-limited during the current run. Shared across the worker
    threads of one /index-article call, and thrown away afterwards."""

    def __init__(self) -> None:
        self._keys: set[str] = set()
        self._lock = threading.Lock()

    def disable(self, key: str) -> None:
        with self._lock:
            self._keys.add(key)

    def is_disabled(self, key: str) -> bool:
        with self._lock:
            return key in self._keys

    def count(self) -> int:
        with self._lock:
            return len(self._keys)


class PageTranscriber:
    """Turns one page image into markdown using one API key."""

    def __init__(self, model: str, registry: DisabledKeyRegistry):
        self._model = model
        self._registry = registry

    def transcribe(self, png_bytes: bytes, api_key: str) -> str:
        if self._registry.is_disabled(api_key):
            raise RateLimitedError(
                f"Key {mask_secret(api_key)} was already rate-limited this run — skipped."
            )

        client = Cerebras(api_key=api_key)
        encoded = base64.b64encode(png_bytes).decode("utf-8")

        last_err: Exception | None = None
        for attempt in range(1, MAX_RETRIES_PER_PAGE + 1):
            try:
                stream = client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": TRANSCRIPTION_PROMPT},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{encoded}"},
                                },
                            ],
                        }
                    ],
                    stream=True,
                )
                return "".join(chunk.choices[0].delta.content or "" for chunk in stream)
            except Exception as err:  # noqa: BLE001 — inspected below, re-raised if not retryable
                last_err = err
                status = getattr(err, "status_code", None)

                if status == 429:
                    if attempt == MAX_RETRIES_PER_PAGE:
                        self._registry.disable(api_key)
                        raise RateLimitedError(
                            f"Key {mask_secret(api_key)} rate-limited (429) after {attempt} attempt(s): {err}"
                        ) from err
                    wait = RATE_LIMIT_BACKOFF_SECONDS * attempt
                    print(
                        f"[gemma] 429 on key {mask_secret(api_key)} — retrying in {wait}s "
                        f"(attempt {attempt}/{MAX_RETRIES_PER_PAGE})"
                    )
                    time.sleep(wait)
                    continue

                if isinstance(status, int) and 500 <= status < 600:
                    if attempt == MAX_RETRIES_PER_PAGE:
                        raise
                    wait = SERVER_ERROR_BACKOFF_SECONDS * attempt
                    print(
                        f"[gemma] {status} server error — retrying in {wait}s "
                        f"(attempt {attempt}/{MAX_RETRIES_PER_PAGE})"
                    )
                    time.sleep(wait)
                    continue

                # Not retryable (bad request, auth error, …) — fail now.
                raise

        assert last_err is not None
        raise last_err
