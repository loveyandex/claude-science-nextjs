# backend (make-science-gemma4)

A small FastAPI service, separate from the Next.js app, that does the parts Next.js can't:
render PDF pages to images (Poppler via `pdf2image`) and call Cerebras' `gemma-4-31b` vision
model on each page. It never touches Postgres — it POSTs each finished page's markdown back to
the Next.js app's `POST /api/articles-gemma4/ingest-page` route, which does the actual save.

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
CEREBRAS_API_KEY=csk-...          # get a fresh one — do not reuse any key pasted in chat/logs
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
- `POST /index-article` — body `{url, pdfUrl}`, header `X-Internal-Secret: <INTERNAL_API_SECRET>`.
  Downloads the PDF, renders every page to a PNG, sends each to Cerebras, and pushes each page's
  markdown to the Next.js app as it completes. Returns `{ok: true, pageCount}` once the whole
  article is done, or `{ok: false, error}` if anything failed partway through (pages already
  pushed before the failure stay saved — this endpoint isn't transactional across pages).
