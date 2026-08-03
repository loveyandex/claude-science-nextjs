"""make-science-gemma4: download a PDF, render every page, transcribe it.

Same pipeline the original single-file backend ran, now expressed as a
service with its collaborators (renderer, transcriber, Next.js client)
injected rather than reached for as module globals. Behaviour is
deliberately unchanged: skip pages a previous run already saved,
round-robin the remaining pages across the supplied keys, push each
finished page's markdown to Next.js as it lands, and never let one bad
page abort the article.
"""

from __future__ import annotations

import io
import itertools
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import httpx
from pdf2image import convert_from_bytes

from app.core.errors import RateLimitedError
from app.core.security import mask_secret
from app.services.nextjs_client import NextJsClient
from app.services.transcription import DisabledKeyRegistry, PageTranscriber


@dataclass
class IndexArticleOutcome:
    ok: bool
    page_count: int = 0
    failed_pages: list[dict] = field(default_factory=list)
    all_keys_rate_limited: bool = False
    error: str | None = None

    def to_response(self) -> dict:
        if not self.ok:
            return {"ok": False, "error": self.error}
        return {
            "ok": True,
            "pageCount": self.page_count,
            "failedPages": self.failed_pages,
            "allKeysRateLimited": self.all_keys_rate_limited,
        }


class PdfPageRenderer:
    """Wraps pdf2image so the poppler detail lives in exactly one place."""

    def __init__(self, dpi: int, poppler_path: str | None):
        self._dpi = dpi
        self._poppler_path = poppler_path

    def render(self, pdf_bytes: bytes):
        return convert_from_bytes(pdf_bytes, dpi=self._dpi, poppler_path=self._poppler_path)


class ArticleIndexingService:
    def __init__(
        self,
        renderer: PdfPageRenderer,
        nextjs: NextJsClient,
        gemma_model: str,
        http_timeout: float = 120.0,
    ):
        self._renderer = renderer
        self._nextjs = nextjs
        self._gemma_model = gemma_model
        self._http_timeout = http_timeout

    def index_article(
        self,
        url: str,
        pdf_url: str,
        skip_pages: list[int],
        api_keys: list[str],
    ) -> IndexArticleOutcome:
        registry = DisabledKeyRegistry()
        transcriber = PageTranscriber(self._gemma_model, registry)
        skip_set = set(skip_pages)
        failed_pages: list[dict] = []

        print(f"[gemma] Rendering and indexing {pdf_url} to {url} with {len(api_keys)} key(s)")

        try:
            with httpx.Client(timeout=self._http_timeout) as client:
                pdf_res = client.get(pdf_url)
                pdf_res.raise_for_status()
                pdf_bytes = pdf_res.content
                print(f"[gemma] Downloaded {len(pdf_bytes)} bytes of PDF from {pdf_url}")

                pages = self._renderer.render(pdf_bytes)
                page_count = len(pages)
                print(f"[gemma] Rendered {page_count} pages of {pdf_url}")

                to_process = [
                    (i + 1, image) for i, image in enumerate(pages) if (i + 1) not in skip_set
                ]
                key_cycle = list(itertools.islice(itertools.cycle(api_keys), len(to_process)))

                def handle_page(page_num: int, image, api_key: str) -> tuple[str, int, str | None]:
                    print(
                        f"[gemma] Processing page {page_num}/{page_count} of {pdf_url} "
                        f"with key {mask_secret(api_key)}"
                    )
                    buf = io.BytesIO()
                    image.save(buf, format="PNG")

                    try:
                        markdown = transcriber.transcribe(buf.getvalue(), api_key)
                    except RateLimitedError as err:
                        print(f"[gemma] Page {page_num}/{page_count} rate-limited: {err}")
                        return ("rate_limited", page_num, str(err))
                    except Exception as err:  # noqa: BLE001
                        print(f"[gemma] Page {page_num}/{page_count} failed permanently: {err}")
                        return ("failed", page_num, str(err))

                    print(f"[gemma] Transcribed page {page_num}/{page_count} ({len(markdown)} chars)")

                    try:
                        self._nextjs.push_page_markdown(client, url, page_num, page_count, markdown)
                    except Exception as err:  # noqa: BLE001
                        print(f"[gemma] Failed to push page {page_num}/{page_count}: {err}")
                        return ("failed", page_num, f"Failed to save: {err}")

                    return ("ok", page_num, None)

                if to_process:
                    with ThreadPoolExecutor(max_workers=max(1, len(api_keys))) as executor:
                        futures = [
                            executor.submit(handle_page, page_num, image, key_cycle[idx])
                            for idx, (page_num, image) in enumerate(to_process)
                        ]
                        for future in futures:
                            status, page_num, err = future.result()
                            if status in ("failed", "rate_limited"):
                                failed_pages.append({"page": page_num, "error": err})

            return IndexArticleOutcome(
                ok=True,
                page_count=page_count,
                failed_pages=failed_pages,
                all_keys_rate_limited=bool(api_keys) and registry.count() >= len(api_keys),
            )
        except Exception as err:  # noqa: BLE001 — reported back as a plain error string
            return IndexArticleOutcome(ok=False, error=str(err))
