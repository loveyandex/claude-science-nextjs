# backend

A FastAPI service, separate from the Next.js app, hosting the two pipelines that need Python:

- **make-science-gemma4** (`POST /index-article`) — renders PDF pages to images (Poppler via
  `pdf2image`) and calls Cerebras' `gemma-4-31b` vision model on each page.
- **make-embedding** (`POST /embedding/*`, `POST /search/similar`) — chunks that markdown and
  embeds it into Qdrant with FastEmbed, then serves similarity search over the result.

It never touches Postgres. Both pipelines push their results back to the Next.js app over HTTP
(`/api/articles-gemma4/ingest-page` and `/api/embeddings/ingest-progress`), which does every
write. One writer for the database is what lets the browser watch a run's progress by reading
Postgres, with no second channel out of this service.

It also doesn't hold onto any Cerebras API key itself. The key pool lives in Postgres, managed
at `/settings` in the Next.js app — every `/index-article` call carries whichever key(s) apply
to that call in its body (`cerebrasApiKeys`). Sending more than one key round-robins that PDF's
pages across them concurrently (a thread per key); sending one processes pages sequentially.
`CEREBRAS_API_KEY` in this service's own `.env` is only ever a last-resort fallback, used if a
request somehow arrives with an empty key list.

Embedding needs no API key at all — FastEmbed runs the model locally, in this process.

## Layout

```
main.py                  ASGI entrypoint; `app = create_app()` and nothing else
app/
  config.py              one typed, cached view of the environment
  dependencies.py        composition root — the only place concrete classes are chosen
  api/
    app_factory.py       builds the FastAPI app, maps domain errors -> status codes
    schemas.py           pydantic wire format (camelCase, matches the Next.js client)
    routes/              health.py, gemma.py, embedding.py, search.py
  core/                  security.py (shared-secret dep), errors.py (domain exceptions)
  domain/                dataclasses + Protocols; imports nothing third-party
  services/              the actual behaviour, depending only on domain/ports
```

The dependency direction only ever points inward: `services/` never imports FastAPI, `domain/`
imports nothing at all. That's what lets the chunker and the embedding orchestration be tested
with fakes, without a running Qdrant, Postgres, or model provider.

## Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

### Poppler (required by `pdf2image`)

`pdf2image` shells out to Poppler's `pdftoppm`/`pdftocairo` binaries — it does **not** bundle
them, and they aren't a pip package. On Windows:

1. Download the latest Poppler for Windows release (search "poppler windows release", e.g. the
   `oschwartz10612/poppler-windows` GitHub releases page) and unzip it somewhere permanent.
2. Either add its `Library\bin` folder to your system PATH, **or** set `POPPLER_PATH` in `.env`
   to that folder's path — this service reads `POPPLER_PATH` and passes it straight through to
   `pdf2image.convert_from_bytes(..., poppler_path=...)`.

If Poppler isn't found, `/index-article` will fail with a "poppler not found" error surfaced back
to the Next.js indexing page's live feed as a per-article error.

### Qdrant (required by `make-embedding`)

Any reachable Qdrant instance works — the quickest is Docker:

```bash
docker run -p 6333:6333 -p 6334:6334 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

Then point `QDRANT_URL` at it. The collection is created automatically on the first embedding
run, with vector dimensions taken from the registered FastEmbed model rather than hard-coded.

The first embedding call also **downloads the embedding model** (~130 MB for the default
`BAAI/bge-small-en`) and loads it into memory. That happens once per process, so the first batch
of a fresh server is noticeably slower than the rest.

## Environment variables (`backend/.env`)

See `.env.example` for the annotated version.

```bash
INTERNAL_API_SECRET=...           # random shared secret, must match Next.js's INTERNAL_API_SECRET
NEXTJS_BASE_URL=http://localhost:7007

# make-science-gemma4
CEREBRAS_API_KEY=csk-...          # OPTIONAL fallback only — real keys live at /settings now
GEMMA_MODEL_NAME=gemma-4-31b
PDF_RENDER_DPI=400
POPPLER_PATH=                     # optional, only if Poppler isn't on PATH

# make-embedding
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                   # only for Qdrant Cloud / a secured instance
EMBEDDING_MODEL_NAME=BAAI/bge-small-en
QDRANT_COLLECTION=fastembed_articles
EMBEDDING_UPSERT_BATCH=32
EMBEDDING_PARALLEL=1              # >1 spawns processes; poor fit for uvicorn --reload on Windows
```

## Running

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Runs as its own process — not part of `npm run dev`. Start it separately whenever you want to use
`/make-science-gemma4`; the Next.js app calls it over HTTP at `BACKEND_URL` (see the main
`.env.example`).

## API

Every route except `/health*` requires `X-Internal-Secret: <INTERNAL_API_SECRET>`.

### Health

- `GET /health` — `{ok: true}`, no auth, for a quick liveness check.
- `GET /health/config` — what this process thinks it's configured to do (booleans and non-secret
  values only). Useful for "is Qdrant even pointed at the right place?".

### make-embedding

- `POST /embedding/embed-pages` — body `{pages[], collection?, chunking:{maxTokens, overlapTokens}}`.
  Chunks each page, embeds from its resume cursor onward, upserts to Qdrant, and POSTs progress
  back to Next.js after every upsert batch. Returns one result per page:
  `{pageId, status, chunkCount, embeddedChunks, contentHash, model, restarted, skipped, error}`.

  The unit of work is a *batch of pages*, never a whole run — this service holds no run state.
  All resume state lives in Postgres, which the Next.js app owns. Stopping a run therefore means
  "stop sending batches", and everything already embedded stays embedded.

  Three rules it enforces, so callers don't have to:
  - Chunking is deterministic for a given `(text, policy)`, so chunk index N always means the
    same slice. That's what makes "resume page 7 at chunk 12" correct rather than approximate.
  - The content hash covers the text, the chunking policy **and** the model. If the caller's
    hash doesn't match, the page is re-embedded from chunk 0 and its stale vectors are deleted
    first — a re-transcribed page can't leave ghosts behind.
  - One page failing fails that page only. The batch continues and the page comes back
    `failed` with its reason.

- `POST /embedding/plan` — same body, chunks but writes nothing. Sizes a run before committing.
- `GET /embedding/collection?collection=` — point count, status, and the model in use.
- `POST /embedding/collection/drop` — body `{collection?, confirm: true}`. Deletes the whole
  collection. Prefer the Next.js app's `POST /api/embeddings/reset`, which also clears the
  Postgres-side cursors — dropping one without the other leaves orphans.

### Similarity search

- `POST /search/similar` — body `{query, limit?, collection?, articleId?, snippetChars?}`.
  Returns scored chunk hits with their article/page metadata and matched text. This is what the
  chat agent's `searchLibrarySemantic` tool ends up calling. Queries have to be encoded with the
  *same* model the chunks were, which is exactly why search lives here rather than in TypeScript
  against Qdrant directly.

### make-science-gemma4

- `POST /index-article` — body `{url, pdfUrl, skipPages?, cerebrasApiKeys}`. Downloads the PDF, renders every page to a PNG
  (skipping any in `skipPages` — already saved from a previous partial run), round-robins the
  rest across `cerebrasApiKeys` concurrently, and pushes each page's markdown to the Next.js app
  as it completes. A key that gets rate-limited (429) after retries is disabled for the rest of
  this call only — other keys keep going. Returns `{ok: true, pageCount, failedPages,
  allKeysRateLimited}` once done (per-page failures don't stop the article), or `{ok: false,
  error}` if something failed before any page-level work could happen (e.g. the PDF itself
  wouldn't download).
