"""Typed, immutable view of this service's environment.

Every module reads configuration through `get_settings()` rather than
touching `os.environ` directly, so there's exactly one place that knows
which variable names exist, what their defaults are, and how to coerce
them. `@lru_cache` makes it a process-wide singleton without a global.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"[config] {name}={raw!r} isn't an integer — falling back to {default}")
        return default


def _str_env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


@dataclass(frozen=True)
class Settings:
    # --- shared -----------------------------------------------------------
    internal_api_secret: str
    nextjs_base_url: str

    # --- gemma4 page transcription ---------------------------------------
    fallback_cerebras_api_key: str
    gemma_model: str
    pdf_dpi: int
    poppler_path: str | None

    # --- Qdrant embedding -------------------------------------------------
    qdrant_url: str
    qdrant_api_key: str | None
    qdrant_timeout_seconds: int
    embedding_model: str
    embedding_collection: str
    # Chunks pushed to Qdrant per `client.add()` call. Small enough that a
    # stopped run loses very little work, big enough that fastembed still
    # gets a worthwhile batch to encode at once.
    embedding_upsert_batch: int
    # fastembed's `parallel` argument. >1 spawns worker *processes*, which
    # is a poor fit for a reloading uvicorn dev server on Windows — hence
    # the conservative default. Raise it on a Linux box doing bulk runs.
    embedding_parallel: int

    @property
    def qdrant_configured(self) -> bool:
        return bool(self.qdrant_url)

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            internal_api_secret=_str_env("INTERNAL_API_SECRET"),
            nextjs_base_url=_str_env("NEXTJS_BASE_URL", "http://localhost:3000").rstrip("/"),
            fallback_cerebras_api_key=_str_env("CEREBRAS_API_KEY"),
            gemma_model=_str_env("GEMMA_MODEL_NAME", "gemma-4-31b"),
            pdf_dpi=_int_env("PDF_RENDER_DPI", 400),
            poppler_path=_str_env("POPPLER_PATH") or None,
            qdrant_url=_str_env("QDRANT_URL", "http://localhost:6333"),
            qdrant_api_key=_str_env("QDRANT_API_KEY") or None,
            qdrant_timeout_seconds=_int_env("QDRANT_TIMEOUT_SECONDS", 120),
            embedding_model=_str_env("EMBEDDING_MODEL_NAME", "BAAI/bge-small-en"),
            embedding_collection=_str_env("QDRANT_COLLECTION", "fastembed_articles"),
            embedding_upsert_batch=_int_env("EMBEDDING_UPSERT_BATCH", 32),
            embedding_parallel=_int_env("EMBEDDING_PARALLEL", 1),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
