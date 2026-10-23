"""DOI pipeline: render a locally-stored PDF's pages and transcribe them.

The make-science-gemma4 shape (render every page → vision model → push
each page's markdown back to Next.js as it lands), applied to PDFs the
Next.js app fetched by DOI. Two differences from ArticleIndexingService:
the PDF is pulled from Next.js itself (it lives on that machine's disk,
not on a public mirror), and pages go to a caller-chosen OpenAI-compatible
provider instead of the Cerebras key pool.
"""

from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.services.article_indexer import IndexArticleOutcome, PdfPageRenderer
from app.services.nextjs_client import NextJsClient
from app.services.transcription import OpenAICompatibleTranscriber


class DoiPdfTranscriptionService:
    def __init__(self, renderer: PdfPageRenderer, nextjs: NextJsClient, http_timeout: float = 120.0):
        self._renderer = renderer
        self._nextjs = nextjs
        self._http_timeout = http_timeout

    def transcribe_pdf(
        self,
        doi: str,
        skip_pages: list[int],
        transcriber: OpenAICompatibleTranscriber,
        concurrency: int,
        dpi: int | None,
    ) -> IndexArticleOutcome:
        skip_set = set(skip_pages)
        failed_pages: list[dict] = []

        try:
            with httpx.Client(timeout=self._http_timeout) as client:
                pdf_bytes = self._nextjs.fetch_doi_pdf(client, doi)
                print(f"[doi] Downloaded {len(pdf_bytes)} bytes of PDF for {doi}")

                pages = self._renderer.render(pdf_bytes, dpi)
                page_count = len(pages)
                print(f"[doi] Rendered {page_count} pages of {doi}")

                to_process = [(i + 1, image) for i, image in enumerate(pages) if (i + 1) not in skip_set]

                def handle_page(page_num: int, image) -> tuple[str, int, str | None]:
                    print(f"[doi] Transcribing page {page_num}/{page_count} of {doi}")
                    # JPEG rather than PNG: a rendered page is several times
                    # smaller, which matters when it's base64'd into a request
                    # to a remote provider.
                    buf = io.BytesIO()
                    image.convert("RGB").save(buf, format="JPEG", quality=90)
                    try:
                        markdown = transcriber.transcribe(buf.getvalue(), "image/jpeg")
                    except Exception as err:  # noqa: BLE001
                        print(f"[doi] Page {page_num}/{page_count} failed: {err}")
                        return ("failed", page_num, str(err))

                    try:
                        self._nextjs.push_doi_page_markdown(client, doi, page_num, page_count, markdown)
                    except Exception as err:  # noqa: BLE001
                        print(f"[doi] Failed to push page {page_num}/{page_count}: {err}")
                        return ("failed", page_num, f"Failed to save: {err}")

                    print(f"[doi] Saved page {page_num}/{page_count} ({len(markdown)} chars)")
                    return ("ok", page_num, None)

                if to_process:
                    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
                        futures = [executor.submit(handle_page, n, img) for n, img in to_process]
                        for future in futures:
                            status, page_num, err = future.result()
                            if status == "failed":
                                failed_pages.append({"page": page_num, "error": err})

            return IndexArticleOutcome(ok=True, page_count=page_count, failed_pages=failed_pages)
        except Exception as err:  # noqa: BLE001 — reported back as a plain error string
            return IndexArticleOutcome(ok=False, error=str(err))
