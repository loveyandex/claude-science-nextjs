"""DOI pipeline: render a locally-stored PDF's pages and transcribe them.

The make-science-gemma4 shape (render every page → vision model → push
each page's markdown back to Next.js as it lands), applied to PDFs the
Next.js app fetched by DOI. Two differences from ArticleIndexingService:
the PDF is pulled from Next.js itself (it lives on that machine's disk,
not on a public mirror), and pages go to a caller-chosen provider
(OpenAI-compatible or Gemini) instead of the Cerebras key pool.
"""

from __future__ import annotations

import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.services.article_indexer import IndexArticleOutcome, PdfPageRenderer
from app.services.nextjs_client import NextJsClient
from app.services.transcription import PageCancelled, VisionTranscriber


class TranscriptionProgress:
    """Live state of one run, read by GET /doi/jobs/{id} while it's going —
    which phase it's in and what each page is doing (waiting on the
    provider, backing off after a 429, failed and why). Without this, a page
    stuck in its retries looks exactly like a hung run from the outside."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._phase = "starting"
        self._message = "Starting…"
        self._page_count: int | None = None
        self._pages: dict[int, dict] = {}
        self._updated_at = time.time()

    def set_phase(self, phase: str, message: str, page_count: int | None = None) -> None:
        with self._lock:
            self._phase = phase
            self._message = message
            if page_count is not None:
                self._page_count = page_count
            self._updated_at = time.time()

    def page(self, page: int, state: str, **fields) -> None:
        with self._lock:
            entry = self._pages.setdefault(page, {})
            entry.update(fields)
            entry["state"] = state
            entry["at"] = time.time()
            self._updated_at = entry["at"]

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "phase": self._phase,
                "message": self._message,
                "pageCount": self._page_count,
                "pages": [{"page": n, **v} for n, v in sorted(self._pages.items())],
                "updatedAt": self._updated_at,
            }


class DoiPdfTranscriptionService:
    def __init__(self, renderer: PdfPageRenderer, nextjs: NextJsClient, http_timeout: float = 120.0):
        self._renderer = renderer
        self._nextjs = nextjs
        self._http_timeout = http_timeout

    def transcribe_pdf(
        self,
        doi: str,
        skip_pages: list[int],
        transcriber: VisionTranscriber,
        concurrency: int,
        dpi: int | None,
        cancel: threading.Event | None = None,
        progress: TranscriptionProgress | None = None,
    ) -> IndexArticleOutcome:
        skip_set = set(skip_pages)
        failed_pages: list[dict] = []
        cancelled_pages: list[int] = []
        progress = progress or TranscriptionProgress()

        try:
            with httpx.Client(timeout=self._http_timeout) as client:
                progress.set_phase("downloading", "Fetching the PDF from the app…")
                try:
                    pdf_bytes = self._nextjs.fetch_doi_pdf(client, doi)
                except Exception as err:  # noqa: BLE001
                    raise RuntimeError(f"Couldn't fetch the PDF from the app: {err}") from err
                print(f"[doi] Downloaded {len(pdf_bytes)} bytes of PDF for {doi}")

                progress.set_phase("rendering", f"Rendering pages to images ({len(pdf_bytes) // 1024} KB PDF)…")
                try:
                    pages = self._renderer.render(pdf_bytes, dpi)
                except Exception as err:  # noqa: BLE001
                    raise RuntimeError(f"Couldn't render the PDF's pages (is poppler installed?): {err}") from err
                page_count = len(pages)
                print(f"[doi] Rendered {page_count} pages of {doi}")

                to_process = [(i + 1, image) for i, image in enumerate(pages) if (i + 1) not in skip_set]
                for n, _ in to_process:
                    progress.page(n, "queued")
                progress.set_phase(
                    "transcribing",
                    f"Transcribing {len(to_process)} of {page_count} pages"
                    + (f" ({len(skip_set)} already saved)" if skip_set else ""),
                    page_count=page_count,
                )

                def handle_page(page_num: int, image) -> tuple[str, int, str | None]:
                    # Checked per page rather than mid-request: a page already
                    # at the provider finishes and is saved, the rest are skipped.
                    if cancel is not None and cancel.is_set():
                        progress.page(page_num, "cancelled")
                        return ("cancelled", page_num, None)
                    print(f"[doi] Transcribing page {page_num}/{page_count} of {doi}")

                    def on_event(kind: str, attempt: int, reason: str | None, wait: float | None) -> None:
                        if kind == "attempt":
                            progress.page(page_num, "running", attempt=attempt, startedAt=time.time())
                        else:
                            progress.page(
                                page_num, "retrying", attempt=attempt, error=reason, retryAt=time.time() + (wait or 0)
                            )

                    # JPEG rather than PNG: a rendered page is several times
                    # smaller, which matters when it's base64'd into a request
                    # to a remote provider.
                    buf = io.BytesIO()
                    image.convert("RGB").save(buf, format="JPEG", quality=90)
                    try:
                        markdown = transcriber.transcribe(buf.getvalue(), "image/jpeg", on_event=on_event, cancel=cancel)
                    except PageCancelled:
                        progress.page(page_num, "cancelled")
                        return ("cancelled", page_num, None)
                    except Exception as err:  # noqa: BLE001
                        print(f"[doi] Page {page_num}/{page_count} failed: {err}")
                        progress.page(page_num, "failed", error=str(err))
                        return ("failed", page_num, str(err))

                    try:
                        self._nextjs.push_doi_page_markdown(client, doi, page_num, page_count, markdown)
                    except Exception as err:  # noqa: BLE001
                        print(f"[doi] Failed to push page {page_num}/{page_count}: {err}")
                        progress.page(page_num, "failed", error=f"Transcribed, but saving it failed: {err}")
                        return ("failed", page_num, f"Transcribed, but saving it failed: {err}")

                    print(f"[doi] Saved page {page_num}/{page_count} ({len(markdown)} chars)")
                    progress.page(page_num, "done", chars=len(markdown))
                    return ("ok", page_num, None)

                if to_process:
                    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
                        futures = [executor.submit(handle_page, n, img) for n, img in to_process]
                        for future in futures:
                            status, page_num, err = future.result()
                            if status == "failed":
                                failed_pages.append({"page": page_num, "error": err})
                            elif status == "cancelled":
                                cancelled_pages.append(page_num)

            if cancelled_pages:
                print(f"[doi] Cancelled {doi} with {len(cancelled_pages)} page(s) not transcribed")
            progress.set_phase(
                "finished",
                f"Finished — {len(to_process) - len(failed_pages) - len(cancelled_pages)} page(s) transcribed"
                + (f", {len(failed_pages)} failed" if failed_pages else "")
                + (f", {len(cancelled_pages)} stopped" if cancelled_pages else ""),
            )
            return IndexArticleOutcome(
                ok=True,
                page_count=page_count,
                failed_pages=failed_pages,
                cancelled_pages=cancelled_pages,
            )
        except Exception as err:  # noqa: BLE001 — reported back as a plain error string
            progress.set_phase("failed", str(err))
            return IndexArticleOutcome(ok=False, error=str(err))
