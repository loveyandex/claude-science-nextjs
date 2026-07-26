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

Run with:  uvicorn main:app --host 0.0.0.0 --port 8000
"""

import base64
import hmac
import io
import os
import time

import httpx
from cerebras.cloud.sdk import Cerebras
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pdf2image import convert_from_bytes
from pydantic import BaseModel

load_dotenv()

CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY")
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
# article keeps going. A 429 almost always means the whole account is
# rate-limited right now — hammering the next page (or the next article)
# will just hit it again — so after retries are exhausted it aborts the
# *entire* /index-article call instead of just skipping the page, and
# reports rateLimited=true so the Next.js orchestrator stops the whole
# batch and tells the user to back off rather than burning through pages.
MAX_RETRIES_PER_PAGE = 3
RATE_LIMIT_BACKOFF_SECONDS = 20
SERVER_ERROR_BACKOFF_SECONDS = 5

print(f"[backend] CEREBRAS_API_KEY configured: {bool(CEREBRAS_API_KEY)}")
print(f"[backend] Using GEMMA_MODEL={GEMMA_MODEL} and PDF_DPI={PDF_DPI}")
print(f"[backend] Using NEXTJS_BASE_URL={NEXTJS_BASE_URL}")

if not CEREBRAS_API_KEY:
    print("[backend] WARNING: CEREBRAS_API_KEY is not set — page conversion calls will fail.")
if not INTERNAL_API_SECRET:
    print(
        "[backend] WARNING: INTERNAL_API_SECRET is not set — this service will refuse every "
        "request until it's configured (must match the Next.js app's value)."
    )

app = FastAPI(title="locaul-science gemma4 backend")

_cerebras_client = Cerebras(api_key=CEREBRAS_API_KEY) if CEREBRAS_API_KEY else None


class RateLimitedError(Exception):
    """Raised once retries on a 429 are exhausted — aborts the whole article."""


class IndexArticleRequest(BaseModel):
    url: str
    pdfUrl: str
    # Page numbers (1-indexed) that already have saved content from a
    # previous partial run — re-rendered (rendering the whole PDF is
    # unavoidable with pdf2image) but not re-sent to Cerebras or re-pushed.
    skipPages: list[int] = []


def check_secret(x_internal_secret: str | None) -> None:
    if not INTERNAL_API_SECRET or not x_internal_secret or not hmac.compare_digest(
        x_internal_secret, INTERNAL_API_SECRET
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Secret header.")


def image_to_markdown(png_bytes: bytes) -> str:
    if _cerebras_client is None:
        raise RuntimeError("CEREBRAS_API_KEY is not configured on the backend service.")

    base64_image = base64.b64encode(png_bytes).decode("utf-8")

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES_PER_PAGE + 1):
        try:
            stream = _cerebras_client.chat.completions.create(
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
                    raise RateLimitedError(
                        f"Cerebras rate-limited (429) after {attempt} attempt(s): {err}"
                    ) from err
                wait = RATE_LIMIT_BACKOFF_SECONDS * attempt
                print(f"[backend] 429 rate limited — retrying in {wait}s (attempt {attempt}/{MAX_RETRIES_PER_PAGE})")
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


def push_page(client: httpx.Client, url: str, page_number: int, page_count: int, content: str) -> None:
    res = client.post(
        f"{NEXTJS_BASE_URL}/api/articles-gemma4/ingest-page",
        json={"url": url, "pageNumber": page_number, "pageCount": page_count, "content": content},
        headers={"X-Internal-Secret": INTERNAL_API_SECRET or ""},
        timeout=30.0,
    )
    res.raise_for_status()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/index-article")
def index_article(body: IndexArticleRequest, x_internal_secret: str | None = Header(default=None)):
    check_secret(x_internal_secret)
    print(f"[backend] Rendering and indexing {body.pdfUrl} to {body.url}")

    skip_set = set(body.skipPages)
    failed_pages: list[dict] = []

    try:
        with httpx.Client(timeout=120.0) as client:
            pdf_res = client.get(body.pdfUrl)
            pdf_res.raise_for_status()
            pdf_bytes = pdf_res.content
            print(f"[backend] Downloaded {len(pdf_bytes)} bytes of PDF from {body.pdfUrl}")

            pages = convert_from_bytes(pdf_bytes, dpi=PDF_DPI, poppler_path=POPPLER_PATH)
            page_count = len(pages)
            print(f"[backend] Rendered {page_count} pages of {body.pdfUrl} at {PDF_DPI} dpi")

            for i, page_image in enumerate(pages):
                page_num = i + 1
                if page_num in skip_set:
                    print(f"[backend] Skipping page {page_num}/{page_count} (already saved from a previous run)")
                    continue

                print(f"[backend] Processing page {page_num}/{page_count} of {body.pdfUrl}")
                buf = io.BytesIO()
                page_image.save(buf, format="PNG")

                try:
                    markdown = image_to_markdown(buf.getvalue())
                except RateLimitedError as err:
                    # Abort the whole article immediately — no point burning
                    # through the remaining pages against the same limit.
                    return {
                        "ok": False,
                        "error": str(err),
                        "rateLimited": True,
                        "pagesDone": page_num - 1 - len(failed_pages),
                    }
                except Exception as err:  # noqa: BLE001 — recorded, this page is skipped, loop continues
                    print(f"[backend] Page {page_num}/{page_count} failed permanently: {err}")
                    failed_pages.append({"page": page_num, "error": str(err)})
                    continue

                print(f"[backend] Transcribed page {page_num}/{page_count} to markdown ({len(markdown)} chars)")

                try:
                    push_page(client, body.url, page_num, page_count, markdown)
                except Exception as err:  # noqa: BLE001 — Next.js unreachable/rejected this page
                    print(f"[backend] Failed to push page {page_num}/{page_count} to Next.js: {err}")
                    failed_pages.append({"page": page_num, "error": f"Failed to save: {err}"})
                    continue

        return {"ok": True, "pageCount": page_count, "failedPages": failed_pages}
    except Exception as err:  # noqa: BLE001 — reported back as a plain error string
        return {"ok": False, "error": str(err)}
