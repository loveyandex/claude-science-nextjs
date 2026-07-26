# backend (make-science-gemma4)

A small FastAPI service, separate from the Next.js app, that does the parts Next.js can't:
render PDF pages to images (Poppler via `pdf2image`) and call Cerebras' `gemma-4-31b` vision
model on each page. It never touches Postgres — it POSTs each finished page's markdown back to
the Next.js app's `POST /api/articles-gemma4/ingest-page` route, which does the actual save.

It also doesn't hold onto any Cerebras API key itself. The key pool lives in Postgres, managed
at `/settings` in the Next.js app — every `/index-article` call carries whichever key(s) apply
to that call in its body (`cerebrasApiKeys`). Sending more than one key round-robins that PDF's
pages across them concurrently (a thread per key); sending one processes pages sequentially.
`CEREBRAS_API_KEY` in this service's own `.env` is only ever a last-resort fallback, used if a
request somehow arrives with an empty key list.

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

## Environment variables (`backend/.env`)

```bash
CEREBRAS_API_KEY=csk-...          # OPTIONAL fallback only — real keys live at /settings now
INTERNAL_API_SECRET=...           # random shared secret, must match Next.js's INTERNAL_API_SECRET
NEXTJS_BASE_URL=http://localhost:3000
GEMMA_MODEL_NAME=gemma-4-31b
PDF_RENDER_DPI=400
POPPLER_PATH=                     # optional, only if Poppler isn't on PATH
```

## Running

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Runs as its own process — not part of `npm run dev`. Start it separately whenever you want to use
`/make-science-gemma4`; the Next.js app calls it over HTTP at `BACKEND_URL` (see the main
`.env.example`).

## API

- `GET /health` — `{ok: true}`, no auth, for a quick liveness check.
- `POST /index-article` — body `{url, pdfUrl, skipPages?, cerebrasApiKeys}`, header
  `X-Internal-Secret: <INTERNAL_API_SECRET>`. Downloads the PDF, renders every page to a PNG
  (skipping any in `skipPages` — already saved from a previous partial run), round-robins the
  rest across `cerebrasApiKeys` concurrently, and pushes each page's markdown to the Next.js app
  as it completes. A key that gets rate-limited (429) after retries is disabled for the rest of
  this call only — other keys keep going. Returns `{ok: true, pageCount, failedPages,
  allKeysRateLimited}` once done (per-page failures don't stop the article), or `{ok: false,
  error}` if something failed before any page-level work could happen (e.g. the PDF itself
  wouldn't download).
