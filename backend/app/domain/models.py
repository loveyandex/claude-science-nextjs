"""Plain domain objects, shared by services and adapters.

Deliberately dataclasses and not pydantic models: these are the service
layer's own vocabulary, not a wire format. The pydantic request/response
schemas live in `app.api.schemas` and are translated to/from these at the
edge, so changing the HTTP contract never forces a change in the domain
(and vice versa).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class EmbeddingStatus(str, Enum):
    PENDING = "pending"
    PARTIAL = "partial"
    EMBEDDED = "embedded"
    FAILED = "failed"


@dataclass(frozen=True)
class ChunkingPolicy:
    """How a page is split. Part of a page's content hash, because
    changing any of it changes the chunk boundaries — and therefore
    invalidates every "resume at chunk N" cursor already recorded."""

    max_tokens: int = 500
    overlap_tokens: int = 60
    # A trailing fragment smaller than this is folded back into the
    # previous chunk instead of becoming a nearly-empty vector.
    min_tokens: int = 24

    def normalized(self) -> "ChunkingPolicy":
        max_tokens = max(32, min(self.max_tokens, 8192))
        overlap = max(0, min(self.overlap_tokens, max_tokens // 2))
        min_tokens = max(1, min(self.min_tokens, max_tokens))
        return ChunkingPolicy(max_tokens=max_tokens, overlap_tokens=overlap, min_tokens=min_tokens)

    def fingerprint(self) -> str:
        return f"v1:{self.max_tokens}:{self.overlap_tokens}:{self.min_tokens}"


@dataclass(frozen=True)
class Chunk:
    index: int
    text: str
    token_estimate: int


@dataclass(frozen=True)
class PageToEmbed:
    """One ArticlePage as handed over by the Next.js orchestrator."""

    page_id: str
    article_id: str
    article_url: str
    page_number: int
    content: str
    title: str = ""
    abstract: str = ""
    # Resume cursor from the database: how many chunks are already in
    # Qdrant. Ignored (treated as 0) if `known_content_hash` doesn't match
    # what this run computes for the content it was actually given.
    start_chunk: int = 0
    known_content_hash: str | None = None


@dataclass(frozen=True)
class ChunkRecord:
    """A chunk on its way into the vector store."""

    point_id: str
    text: str
    payload: dict


@dataclass
class PageEmbeddingResult:
    page_id: str
    article_id: str
    page_number: int
    status: EmbeddingStatus
    chunk_count: int
    embedded_chunks: int
    content_hash: str
    model: str
    restarted: bool = False
    skipped: bool = False
    error: str | None = None
    embedded_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class SearchHit:
    score: float
    article_id: str
    article_url: str
    page_id: str
    page_number: int
    chunk_index: int
    title: str
    abstract: str
    text: str


@dataclass(frozen=True)
class CollectionInfo:
    name: str
    exists: bool
    points_count: int = 0
    vectors_count: int = 0
    status: str = "missing"
