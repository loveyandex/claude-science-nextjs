"""
make-science-gemma4 backend: renders each page of a PDF to a PNG image
(pdf2image / Poppler, dpi=400) and asks Cerebras' gemma-4-31b vision model
to transcribe that page to markdown.

This service never talks to Postgres directly — it's a "dumb" converter.
As each page finishes, it POSTs the markdown straight to the Next.js app's
/api/articles-gemma4/ingest-page route, which does the actual Prisma write.
That keeps exactly one thing (the Next.js app) owning the database, and
lets the Next.js orchestrator (articles-gemma4/index) watch Postgres for
live per-page progress instead of needing a second channel back from here.

This service also doesn't own any Cerebras API key itself — Next.js owns
the key pool (managed at /settings, stored in Postgres) and sends whichever
key(s) apply to a given call in the request body. Sending more than one key
round-robins pages across them concurrently (a thread per key); sending
exactly one processes that PDF's pages sequentially with that one key.
Whether a batch run uses "all keys on one PDF" or "one key per PDF, many
PDFs at once" is entirely a Next.js-side decision — this service just does
whatever it's told for a single /index-article call.

Run with:  uvicorn main:app --host 0.0.0.0 --port 8000
"""

import base64
import hmac
import io
import itertools
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from cerebras.cloud.sdk import Cerebras
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pdf2image import convert_from_bytes
from pydantic import BaseModel

load_dotenv()

# Fallback only — used solely if a request arrives with no keys at all
# (e.g. this service is called directly, bypassing Next.js). The normal
# path always uses body.cerebrasApiKeys from the request.
FALLBACK_CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET")
NEXTJS_BASE_URL = os.environ.get("NEXTJS_BASE_URL", "http://localhost:3000")
GEMMA_MODEL = os.environ.get("GEMMA_MODEL_NAME", "gemma-4-31b")
PDF_DPI = int(os.environ.get("PDF_RENDER_DPI", "400"))
# Poppler's pdftoppm/pdftocairo binaries usually aren't on PATH on Windows
# unless explicitly installed and added — see backend/README.md.
POPPLER_PATH = os.environ.get("POPPLER_PATH") or None

# Retry policy for a single page's Cerebras call. 429 (rate limit) and 5xx
# are treated differently: a 5xx is usually transient/page-specific, so
# after retries are exhausted that one page is recorded as failed and the
# article keeps going. A 429 means *that key* is rate-limited right now —
# after retries are exhausted, that key is disabled for the rest of this
# call (other keys, if any, keep working; pages already assigned to the
# disabled key fail fast instead of wasting further retries on it).
MAX_RETRIES_PER_PAGE = 3
RATE_LIMIT_BACKOFF_SECONDS = 20
SERVER_ERROR_BACKOFF_SECONDS = 5

print(f"[backend] FALLBACK_CEREBRAS_API_KEY configured: {bool(FALLBACK_CEREBRAS_API_KEY)}")
print(f"[backend] Using GEMMA_MODEL={GEMMA_MODEL} and PDF_DPI={PDF_DPI}")
print(f"[backend] Using NEXTJS_BASE_URL={NEXTJS_BASE_URL}")

if not INTERNAL_API_SECRET:
    print(
        "[backend] WARNING: INTERNAL_API_SECRET is not set — this service will refuse every "
        "request until it's configured (must match the Next.js app's value)."
    )

app = FastAPI(title="locaul-science gemma4 backend")


class RateLimitedError(Exception):
    """Raised once retries on a 429 are exhausted for a given key."""


class IndexArticleRequest(BaseModel):
    url: str
    pdfUrl: str
    # Page numbers (1-indexed) that already have saved content from a
    # previous partial run — re-rendered (rendering the whole PDF is
    # unavoidable with pdf2image) but not re-sent to Cerebras or re-pushed.
    skipPages: list[int] = []
    # The Cerebras API key(s) to use for this call, supplied by Next.js
    # (from the pool managed at /settings). One key = sequential pages,
    # several keys = round-robinned across pages concurrently.
    cerebrasApiKeys: list[str] = []


def check_secret(x_internal_secret: str | None) -> None:
    if not INTERNAL_API_SECRET or not x_internal_secret or not hmac.compare_digest(
        x_internal_secret, INTERNAL_API_SECRET
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Secret header.")


def mask_key(key: str) -> str:
    if len(key) <= 10:
        return "••••••••"
    return f"{key[:6]}…{key[-4:]}"


def image_to_markdown(png_bytes: bytes, api_key: str, disabled_keys: set[str], lock: threading.Lock) -> str:
    if api_key in disabled_keys:
        raise RateLimitedError(f"Key {mask_key(api_key)} was already rate-limited this run — skipped.")

    client = Cerebras(api_key=api_key)
    base64_image = base64.b64encode(png_bytes).decode("utf-8")

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES_PER_PAGE + 1):
        try:
            stream = client.chat.completions.create(
                model=GEMMA_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Transcribe everything on this page (text, tables, figure "
                                "captions, equations) as clean markdown. Output only the markdown, "
                                "nothing else.",
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{base64_image}"},
                            },
                        ],
                    }
                ],
                stream=True,
            )
            chunks: list[str] = []
            for chunk in stream:
                chunks.append(chunk.choices[0].delta.content or "")
            return "".join(chunks)
        except Exception as err:  # noqa: BLE001 — inspected below, re-raised if not retryable
            last_err = err
            status = getattr(err, "status_code", None)

            if status == 429:
                if attempt == MAX_RETRIES_PER_PAGE:
                    with lock:
                        disabled_keys.add(api_key)
                    raise RateLimitedError(
                        f"Key {mask_key(api_key)} rate-limited (429) after {attempt} attempt(s): {err}"
                    ) from err
                wait = RATE_LIMIT_BACKOFF_SECONDS * attempt
                print(
                    f"[backend] 429 on key {mask_key(api_key)} — retrying in {wait}s "
                    f"(attempt {attempt}/{MAX_RETRIES_PER_PAGE})"
                )
                time.sleep(wait)
                continue

            if isinstance(status, int) and 500 <= status < 600:
                if attempt == MAX_RETRIES_PER_PAGE:
                    raise
                wait = SERVER_ERROR_BACKOFF_SECONDS * attempt
                print(
                    f"[backend] {status} server error — retrying in {wait}s (attempt {attempt}/{MAX_RETRIES_PER_PAGE})"
                )
                time.sleep(wait)
                continue

            # Not a retryable status (bad request, auth error, etc.) — fail immediately.
            raise

    assert last_err is not None
    raise last_err


def push_page(client: httpx.Client, url: str, page_number: int, page_count: int, content: str, secret: str) -> None:
    res = client.post(
        f"{NEXTJS_BASE_URL}/api/articles-gemma4/ingest-page",
        json={"url": url, "pageNumber": page_number, "pageCount": page_count, "content": content},
        headers={"X-Internal-Secret": secret},
        timeout=30.0,
    )
    res.raise_for_status()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/index-article")
def index_article(body: IndexArticleRequest, x_internal_secret: str | None = Header(default=None)):
    check_secret(x_internal_secret)

    keys = [k for k in body.cerebrasApiKeys if k] or ([FALLBACK_CEREBRAS_API_KEY] if FALLBACK_CEREBRAS_API_KEY else [])
    if not keys:
        return {
            "ok": False,
            "error": "No Cerebras API key available — add one at /settings, or set CEREBRAS_API_KEY in backend/.env as a fallback.",
        }

    print(f"[backend] Rendering and indexing {body.pdfUrl} to {body.url} with {len(keys)} key(s)")

    skip_set = set(body.skipPages)
    failed_pages: list[dict] = []
    disabled_keys: set[str] = set()
    lock = threading.Lock()

    try:
        with httpx.Client(timeout=120.0) as client:
            pdf_res = client.get(body.pdfUrl)
            pdf_res.raise_for_status()
            pdf_bytes = pdf_res.content
            print(f"[backend] Downloaded {len(pdf_bytes)} bytes of PDF from {body.pdfUrl}")

            pages = convert_from_bytes(pdf_bytes, dpi=PDF_DPI, poppler_path=POPPLER_PATH)
            page_count = len(pages)
            print(f"[backend] Rendered {page_count} pages of {body.pdfUrl} at {PDF_DPI} dpi")

            to_process = [
                (i + 1, page_image) for i, page_image in enumerate(pages) if (i + 1) not in skip_set
            ]
            key_cycle = list(itertools.islice(itertools.cycle(keys), len(to_process)))

            def handle_page(page_num: int, page_image, api_key: str) -> tuple[str, int, str | None]:
                print(f"[backend] Processing page {page_num}/{page_count} of {body.pdfUrl} with key {mask_key(api_key)}")
                buf = io.BytesIO()
                page_image.save(buf, format="PNG")

                try:
                    markdown = image_to_markdown(buf.getvalue(), api_key, disabled_keys, lock)
                except RateLimitedError as err:
                    print(f"[backend] Page {page_num}/{page_count} rate-limited: {err}")
                    return ("rate_limited", page_num, str(err))
                except Exception as err:  # noqa: BLE001
                    print(f"[backend] Page {page_num}/{page_count} failed permanently: {err}")
                    return ("failed", page_num, str(err))

                print(f"[backend] Transcribed page {page_num}/{page_count} ({len(markdown)} chars)")

                try:
                    push_page(client, body.url, page_num, page_count, markdown, x_internal_secret or "")
                except Exception as err:  # noqa: BLE001
                    print(f"[backend] Failed to push page {page_num}/{page_count} to Next.js: {err}")
                    return ("failed", page_num, f"Failed to save: {err}")

                return ("ok", page_num, None)

            if to_process:
                with ThreadPoolExecutor(max_workers=max(1, len(keys))) as executor:
                    futures = [
                        executor.submit(handle_page, page_num, page_image, key_cycle[idx])
                        for idx, (page_num, page_image) in enumerate(to_process)
                    ]
                    for future in futures:
                        status, page_num, err = future.result()
                        if status in ("failed", "rate_limited"):
                            failed_pages.append({"page": page_num, "error": err})

        all_keys_rate_limited = len(keys) > 0 and len(disabled_keys) >= len(keys)
        return {
            "ok": True,
            "pageCount": page_count,
            "failedPages": failed_pages,
            "allKeysRateLimited": all_keys_rate_limited,
        }
    except Exception as err:  # noqa: BLE001 — reported back as a plain error string
        return {"ok": False, "error": str(err)}
