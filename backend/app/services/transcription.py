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
import json
import threading
import time
from collections.abc import Callable

import httpx
from cerebras.cloud.sdk import Cerebras

from app.config import get_settings
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


class PageCancelled(Exception):
    """The run was cancelled while this page was waiting to retry."""


# Called as on_event("attempt", n, None, None) before each request and
# on_event("retry", next_attempt, reason, wait_seconds) before a backoff.
TranscribeEventHook = Callable[[str, int, str | None, float | None], None]

_HTTP_HINTS = {
    400: "bad request — wrong model name, or this model doesn't accept images",
    401: "authentication failed — check the provider's API key",
    402: "out of credits at the provider",
    403: "access denied — check the API key and that it can use this model",
    404: "model or endpoint not found — check the model name and base URL",
    413: "page image too large for this provider",
    429: "rate limited by the provider",
}


def _http_error_message(status: int, body: str) -> str:
    detail = body.strip()[:300]
    try:
        data = json.loads(body)
        err = data[0].get("error") if isinstance(data, list) and data else data.get("error")
        message = err.get("message") if isinstance(err, dict) else err or data.get("message")
        if message:
            detail = str(message)[:300]
    except Exception:  # noqa: BLE001 — not JSON; keep the raw text
        pass
    hint = _HTTP_HINTS.get(status) or ("provider server error" if 500 <= status < 600 else "provider error")
    return f"{status} {hint}: {detail}" if detail else f"{status} {hint}"


VISION_MAX_ATTEMPTS = 5

_vision_client: httpx.Client | None = None
_vision_client_lock = threading.Lock()


def _vision_http() -> httpx.Client:
    """One pooled client for every vision request in the process (it's
    thread-safe, and reusing connections means far fewer fresh TCP/TLS
    handshakes to a flaky gateway). trust_env=False: httpx would otherwise
    pick up the Windows system proxy from the registry — typically a VPN
    client's local port that refuses connections whenever it's off or
    switching — while the Next.js chat (Node fetch) always goes direct.
    VISION_HTTP_PROXY opts back into a proxy explicitly."""
    global _vision_client
    with _vision_client_lock:
        if _vision_client is None:
            proxy = get_settings().vision_http_proxy
            _vision_client = httpx.Client(trust_env=False, proxy=proxy)
            print(f"[doi] vision HTTP client: {'proxy ' + proxy if proxy else 'direct (system proxy ignored)'}")
        return _vision_client


def _transport_error_message(err: httpx.TransportError, url: str, timeout: float) -> str:
    host = httpx.URL(url).host
    if isinstance(err, httpx.TimeoutException):
        return f"no response from {host} within {timeout:.0f}s"
    if isinstance(err, httpx.ConnectError):
        return f"couldn't connect to {host} ({err})"
    return f"connection to {host} failed ({err!r})"


def _post_json_with_retries(
    url: str,
    payload: dict,
    headers: dict,
    timeout: float,
    on_event: TranscribeEventHook | None = None,
    cancel: threading.Event | None = None,
) -> dict:
    """POST for the per-run vision transcribers below. Same retry policy as
    PageTranscriber, minus the key registry: there's only one credential,
    so a 429 that outlasts the retries just fails the page. A cancel during
    a backoff wait ends the wait (PageCancelled) instead of sleeping it out."""

    def backoff(next_attempt: int, reason: str, wait: float) -> None:
        print(f"[doi] {reason} — retrying in {wait:.0f}s (attempt {next_attempt}/{VISION_MAX_ATTEMPTS})")
        if on_event:
            on_event("retry", next_attempt, reason, wait)
        if cancel is not None:
            if cancel.wait(wait):
                raise PageCancelled()
        else:
            time.sleep(wait)

    for attempt in range(1, VISION_MAX_ATTEMPTS + 1):
        if on_event:
            on_event("attempt", attempt, None, None)
        try:
            res = _vision_http().post(url, json=payload, headers=headers, timeout=timeout)
        except httpx.TransportError as err:
            # Timeouts and dropped connections — seen from a busy hosted
            # provider — are as transient as a 5xx.
            reason = _transport_error_message(err, url, timeout)
            if attempt == VISION_MAX_ATTEMPTS:
                raise RuntimeError(f"{reason} — gave up after {attempt} attempt(s)") from err
            backoff(attempt + 1, reason, SERVER_ERROR_BACKOFF_SECONDS * attempt)
            continue
        if res.status_code >= 400:
            reason = _http_error_message(res.status_code, res.text)
            retryable = res.status_code == 429 or 500 <= res.status_code < 600
            if retryable and attempt < VISION_MAX_ATTEMPTS:
                base = RATE_LIMIT_BACKOFF_SECONDS if res.status_code == 429 else SERVER_ERROR_BACKOFF_SECONDS
                backoff(attempt + 1, reason, base * attempt)
                continue
            raise RuntimeError(f"{reason}{f' — gave up after {attempt} attempt(s)' if retryable else ''}")
        try:
            return res.json()
        except ValueError as err:
            raise RuntimeError(f"provider answered {res.status_code} with non-JSON: {res.text[:200]}") from err

    raise RuntimeError("Transcription retries exhausted")


class OpenAICompatibleTranscriber:
    """Same "one page image in, markdown out" step, against any
    OpenAI-compatible `/chat/completions` endpoint (Ollama, vLLM, LM Studio,
    a hosted gateway…) whose model accepts image input — e.g. gemma4:31b.
    Used by the DOI pipeline, where the provider is picked per run in the
    UI rather than drawn from the Cerebras key pool."""

    def __init__(self, base_url: str, api_key: str | None, model: str, timeout_seconds: float = 90.0):
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._api_key = api_key
        self._model = model
        self._timeout = timeout_seconds

    def transcribe(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        on_event: TranscribeEventHook | None = None,
        cancel: threading.Event | None = None,
    ) -> str:
        encoded = base64.b64encode(image_bytes).decode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        payload = {
            "model": self._model,
            "stream": False,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": TRANSCRIPTION_PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}},
                    ],
                }
            ],
        }

        data = _post_json_with_retries(self._url, payload, headers, self._timeout, on_event, cancel)
        choices = data.get("choices") or []
        content = (choices[0].get("message") or {}).get("content") if choices else None
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        if not content or not content.strip():
            raise RuntimeError("Provider returned an empty transcription — does this model accept images?")
        return content


GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_RECITATION_TEMPERATURES = (0, 1.0)


def _gemini_empty_message(reason: str | None) -> str:
    if reason == "RECITATION":
        return (
            "Gemini refused to transcribe this page (finishReason RECITATION — its copyright filter blocks "
            "verbatim copies of published text). Retry later, or read this page with another model/provider"
        )
    if reason in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"):
        return f"Gemini's content filter blocked this page (finishReason {reason})"
    if reason == "MAX_TOKENS":
        return "Gemini hit its output token limit before writing any text (finishReason MAX_TOKENS)"
    return (
        f"Gemini returned an empty transcription{f' (finishReason {reason})' if reason else ''}"
        " — check that this model accepts images"
    )


class GeminiTranscriber:
    """The same step against Google's Gemini API (`models/<model>:generateContent`,
    image sent inline) — every current Gemini model, and the Gemma models
    Google serves there, take images. `base_url` is the provider's own
    (e.g. a proxy ending in /v1beta), defaulting to Google's endpoint, the
    same way the Next.js app's @ai-sdk/google client resolves it."""

    def __init__(self, base_url: str | None, api_key: str | None, model: str, timeout_seconds: float = 120.0):
        model_id = model.strip().removeprefix("models/")
        self._url = f"{(base_url or GEMINI_DEFAULT_BASE_URL).rstrip('/')}/models/{model_id}:generateContent"
        self._api_key = api_key
        self._timeout = timeout_seconds

    def transcribe(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        on_event: TranscribeEventHook | None = None,
        cancel: threading.Event | None = None,
    ) -> str:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["x-goog-api-key"] = self._api_key
        contents = [
            {
                "role": "user",
                "parts": [
                    {"text": TRANSCRIPTION_PROMPT},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("utf-8")}},
                ],
            }
        ]

        # RECITATION is Gemini's copyright filter refusing to repeat published
        # text verbatim — common on a paper's first page. It's partly a
        # decoding artefact, so one retry at a higher temperature often gets
        # through where temperature 0 deterministically trips it again.
        reason = None
        for temperature in GEMINI_RECITATION_TEMPERATURES:
            payload = {"contents": contents, "generationConfig": {"temperature": temperature}}
            data = _post_json_with_retries(self._url, payload, headers, self._timeout, on_event, cancel)
            block = (data.get("promptFeedback") or {}).get("blockReason")
            if block:
                raise RuntimeError(f"Gemini refused the page image (blockReason {block})")
            candidates = data.get("candidates") or []
            if not candidates:
                raise RuntimeError("Gemini returned no answer for this page")
            parts = (candidates[0].get("content") or {}).get("parts") or []
            # Thinking models can return their reasoning as parts flagged `thought`.
            text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
            if text.strip():
                return text
            reason = candidates[0].get("finishReason")
            if reason != "RECITATION":
                break
            print(f"[doi] Gemini RECITATION at temperature {temperature} — retrying with more variation")

        raise RuntimeError(_gemini_empty_message(reason))


VisionTranscriber = OpenAICompatibleTranscriber | GeminiTranscriber


def build_vision_transcriber(provider_type: str, base_url: str | None, api_key: str | None, model: str) -> VisionTranscriber:
    """Picks the transcriber for an AiProvider row's `type`."""
    if provider_type == "google":
        return GeminiTranscriber(base_url=base_url, api_key=api_key, model=model)
    if not base_url:
        raise ValueError("An openai-compatible provider needs a baseUrl")
    return OpenAICompatibleTranscriber(base_url=base_url, api_key=api_key, model=model)
