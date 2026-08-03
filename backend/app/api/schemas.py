"""Wire format. Pydantic lives here and nowhere else.

Field names are camelCase because the only client is the Next.js app —
translation to the domain's snake_case happens in `to_domain()` helpers
so no service ever sees a JSON-shaped object.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.domain.models import ChunkingPolicy, PageEmbeddingResult, PageToEmbed, SearchHit


# --- gemma4 -----------------------------------------------------------------


class IndexArticleRequest(BaseModel):
    url: str
    pdfUrl: str
    # Page numbers (1-indexed) already saved by a previous partial run —
    # still re-rendered (pdf2image has no way to render a subset cheaply
    # here) but not re-sent to the vision model or re-pushed.
    skipPages: list[int] = []
    # Supplied per-call by Next.js, which owns the key pool. One key means
    # sequential pages; several round-robin across threads.
    cerebrasApiKeys: list[str] = []


# --- embedding --------------------------------------------------------------


class PagePayload(BaseModel):
    pageId: str
    articleId: str
    articleUrl: str = ""
    pageNumber: int
    content: str
    title: str = ""
    abstract: str = ""
    # Resume cursor from Postgres. Honoured only if contentHash still
    # matches what this service computes for the content it was given.
    startChunk: int = 0
    contentHash: str | None = None

    def to_domain(self) -> PageToEmbed:
        return PageToEmbed(
            page_id=self.pageId,
            article_id=self.articleId,
            article_url=self.articleUrl,
            page_number=self.pageNumber,
            content=self.content,
            title=self.title,
            abstract=self.abstract,
            start_chunk=max(0, self.startChunk),
            known_content_hash=self.contentHash,
        )


class ChunkingPolicyPayload(BaseModel):
    maxTokens: int = 500
    overlapTokens: int = 60
    minTokens: int = 24

    def to_domain(self) -> ChunkingPolicy:
        return ChunkingPolicy(
            max_tokens=self.maxTokens,
            overlap_tokens=self.overlapTokens,
            min_tokens=self.minTokens,
        ).normalized()


class EmbedPagesRequest(BaseModel):
    pages: list[PagePayload] = Field(default_factory=list)
    collection: str | None = None
    chunking: ChunkingPolicyPayload = Field(default_factory=ChunkingPolicyPayload)
    # When false, progress is computed and returned but nothing is pushed
    # back to Next.js and nothing is written to Qdrant (see /embedding/plan).
    reportProgress: bool = True


class PageResultResponse(BaseModel):
    pageId: str
    articleId: str
    pageNumber: int
    status: str
    chunkCount: int
    embeddedChunks: int
    contentHash: str
    model: str
    restarted: bool = False
    skipped: bool = False
    error: str | None = None

    @staticmethod
    def from_domain(result: PageEmbeddingResult) -> "PageResultResponse":
        return PageResultResponse(
            pageId=result.page_id,
            articleId=result.article_id,
            pageNumber=result.page_number,
            status=result.status.value,
            chunkCount=result.chunk_count,
            embeddedChunks=result.embedded_chunks,
            contentHash=result.content_hash,
            model=result.model,
            restarted=result.restarted,
            skipped=result.skipped,
            error=result.error,
        )


class EmbedPagesResponse(BaseModel):
    ok: bool
    collection: str
    model: str
    results: list[PageResultResponse] = Field(default_factory=list)
    totalChunksEmbedded: int = 0
    error: str | None = None


class CollectionInfoResponse(BaseModel):
    name: str
    exists: bool
    pointsCount: int = 0
    vectorsCount: int = 0
    status: str = "missing"
    model: str = ""


class DropCollectionRequest(BaseModel):
    collection: str | None = None
    # Spelled-out confirmation so a mis-fired request can't wipe a
    # collection that took hours to build.
    confirm: bool = False


# --- search -----------------------------------------------------------------


class SearchRequest(BaseModel):
    query: str
    limit: int = 5
    collection: str | None = None
    articleId: str | None = None
    snippetChars: int | None = None


class SearchHitResponse(BaseModel):
    score: float
    articleId: str
    articleUrl: str
    pageId: str
    pageNumber: int
    chunkIndex: int
    title: str
    abstract: str
    text: str

    @staticmethod
    def from_domain(hit: SearchHit) -> "SearchHitResponse":
        return SearchHitResponse(
            score=round(hit.score, 6),
            articleId=hit.article_id,
            articleUrl=hit.article_url,
            pageId=hit.page_id,
            pageNumber=hit.page_number,
            chunkIndex=hit.chunk_index,
            title=hit.title,
            abstract=hit.abstract,
            text=hit.text,
        )


class SearchResponse(BaseModel):
    ok: bool
    query: str
    collection: str
    count: int
    results: list[SearchHitResponse] = Field(default_factory=list)
    error: str | None = None
