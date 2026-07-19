# locaul science

A Next.js (App Router) app: chat with an LLM grounded in your own locally-indexed paper
library, plus a pipeline that reads real PDFs from your article repo, extracts title + abstract
with an LLM, and saves them to a local SQLite database via Prisma (v7, driver-adapter pattern).

## What's here

- **`/make-science`** — indexing pipeline (unchanged across this and the prior pass, per
  instructions not to touch its features). Diffs your repo's article list against the local DB
  every visit, streams progress while it fetches each PDF, reads the first page, and asks the
  LLM for a clean title + abstract.
- **`/chat`** — the production chat surface, restyled this pass to match claude.ai's actual
  token values and interaction patterns (see "This pass's fixes" below).
- **`/chat-assist-ui`** — a second, fuller chat build following assistant-ui's own
  ["Claude Clone" reference example](https://www.assistant-ui.com/examples/claude) more closely
  (topic chips, attachment row, edit-message, thumbs up/down). Same `/api/chat` backend as
  `/chat` — a comparison/testing surface, not a separate product.
- **`/library`** — the original dummy-data paper search/browse pages, untouched.

Both chat pages call the same `POST /api/chat` (AI SDK v7 `streamText`), which now has **four**
tools over the local `Article` table (not `ARTICLES_LIST_URL` — chat only ever sees what's
actually been indexed):

| Tool | Needs a keyword? | Use |
|---|---|---|
| `searchArticles` | yes | keyword search across title/abstract |
| `listRecentArticles` | no | "what's in the library" / browse newest-first |
| `getLibraryStats` | no | indexed/failed counts, most recent indexing activity |
| `getArticleByUrl` | no (needs a url) | pull one article's full record after a search hit |

## This pass's fixes

**F1 — chat UI/UX.** The real problem wasn't just color, it was boxiness: every tool call, every
suggestion chip, every panel had its own bordered rectangle, which reads as visual noise
stacked up in a transcript. Fixed:
- Colors now come directly from the dark-mode token dump you pasted (`gray-750/800/840/900` for
  surfacing, `gray-0/350` for text) — mapped onto this project's existing token names in
  `src/app/globals.css` so nothing else needed to change to pick it up.
- **`--sidebar` is now literally the same color as `--background`**, per your note — they're
  separated by a `border-border/60`–`/70` hairline, never a fill-color difference. Applied to the
  icon rail, header, and mobile tab switcher in `app-shell.tsx`.
- Borders generally moved from full-opacity to `/60`–`/70` opacity across the board (composer,
  suggestion chips, thread rail) — same hue, much quieter line, which is what "thin" actually
  means in claude.ai's own CSS (they do this with the exact same technique, opacity modifiers on
  a light-in-dark / dark-in-light border color, not a sub-pixel border width).

**F4 — tool call UX.** Completely rebuilt in `src/components/assistant-ui/tool-call.tsx`:
collapsed by default to a single ghost row (icon + short human-readable status + chevron, no box,
just a hover highlight), expands on click to show clean key/value args and a formatted result
list — not a raw JSON dump in a bordered rectangle. Also added
`src/components/assistant-ui/thinking-indicator.tsx`: a small sparkle + pulsing-dots row shown
specifically while `message.status.type === "running" && message.content.length === 0` — i.e.
genuinely waiting on the first token/part from the API — and it disappears the instant anything
(text or a tool call) starts streaming in. Both pieces are shared between `/chat` and
`/chat-assist-ui`.

**More search tools**, per your ask for search "without keywords": `listRecentArticles` and
`getLibraryStats` need no query at all; `getArticleByUrl` needs a url but not a keyword. The
system prompt in `/api/chat/route.ts` now explicitly tells the model which tool fits which kind
of question, and explicitly says to use the real tool-calling mechanism rather than writing tool
JSON out as plain text — the garbled `{"tool": "functions.searchArticles", ...}` text you saw in
your screenshots was the model narrating a malformed call instead of actually issuing one; a
clearer system prompt plus `searchArticles.query` now being required-and-non-empty (so the model
can't call it with `{}` and get zero results) should reduce that. This is a model/endpoint
behavior question as much as a prompt one — if it persists with your specific `OPENAI_BASE_URL`
model, it's worth checking whether that endpoint fully supports native tool-calling.

**Branding** — renamed to **locaul science** (your explicit correction) everywhere: page title,
`package.json` name, the internal model provider label, and this README.

**Prisma v7 driver-adapter migration** — per your note, switched to the `@prisma/adapter-better-sqlite3`
+ `better-sqlite3` pattern:
- `prisma/schema.prisma`: `datasource` block no longer has a `url` — that config moved to...
- `prisma.config.ts` (new): `defineConfig({ schema, datasource: { url: process.env.DATABASE_URL } })`,
  used by CLI commands (`db push`, `studio`, etc).
- `src/lib/prisma.ts`: `PrismaClient` is now constructed with an explicit `adapter: new
  PrismaBetterSqlite3({ url })` — Prisma 7 requires this; there's no more implicit
  `DATABASE_URL`-only connection.
- `next.config.mjs`: added `better-sqlite3` and `@prisma/adapter-better-sqlite3` to
  `serverComponentsExternalPackages` since better-sqlite3 is a native binding, not a bundle-able
  JS module.

## Design reference

`.agents/skills/frontend-ui-conventions/SKILL.md` — the token table, chat-specific UI patterns
(ghost tool calls, hover-only action bars, sidebar=background), and a note on which Radix Themes
components (Skeleton, Scroll Area, Data List, etc.) are worth reaching for later instead of
hand-rolling. Read this before touching any page's styling.

## Stack

- Next.js 14 (App Router) + TypeScript
- Prisma 7 (driver adapters) + `better-sqlite3` — `Article` model (`prisma/schema.prisma`)
- `unpdf` — extracts text from the first page of each PDF
- Vercel AI SDK **v7** (`ai@7`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) — `streamText`,
  `generateObject`, tool calling
- `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-markdown` — chat
  UI/UX for both `/chat` and `/chat-assist-ui`
- Tailwind + hand-rolled shadcn/ui-style primitives (`src/components/ui/`)

## One-time setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npx prisma db push     # creates prisma/dev.db with the Article table
npm run dev
```

### `.env` values

```bash
DATABASE_URL="file:./dev.db"

# Your article/PDF repo:
ARTICLES_LIST_URL="http://10.80.31.12:3000/articles"   # returns a JSON array of relative paths
ARTICLES_BASE_URL="http://10.80.31.12:3000"             # prefixed to each path to fetch the PDF

# LLM — any OpenAI-compatible endpoint (OpenAI itself, Groq, a local vLLM/Ollama server, etc.)
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
MODEL_NAME="gpt-4o-mini"
```

> **Note on this build:** the sandbox I worked in blocks `binaries.prisma.sh` (Prisma's
> schema-engine download — needed even with the driver-adapter pattern, since `prisma generate`
> still validates the schema through it), `fonts.googleapis.com`, `r.assistant-ui.com`, and your
> private `10.80.31.12` repo. I could not run `prisma generate`, `npx prisma db push`, or the
> real indexing loop here. Everything else typechecks cleanly (`npx tsc --noEmit` — down to
> exactly one error, the un-generated `PrismaClient` export, which is the direct and only
> consequence of the blocked download) and `npm run build` gets through webpack compilation and
> font handling fine — it stops at that same single Prisma step. Once you run `npx prisma db
> push` locally with real network access, that error resolves and the rest of the build proceeds
> — nothing else in this pass depends on network access this sandbox doesn't have.

## Project structure

```
prisma/schema.prisma          Article model (SQLite, v7 driver-adapter — no url in datasource)
prisma.config.ts               CLI-only datasource URL (Prisma 7 pattern)
src/lib/
  prisma.ts                    PrismaClient + PrismaBetterSqlite3 adapter
  pdf.ts                       first-page text extraction (unpdf)
  ai-provider.ts                shared OpenAI-compatible model from env
  articles-source.ts             fetch repo list + build PDF URLs (make-science only)
src/app/
  api/articles/pending/route.ts   GET  — diff repo list vs DB
  api/articles/index/route.ts      POST — streaming indexing loop
  api/chat/route.ts                POST — streamText + 4 tools over the Article table
  make-science/page.tsx             indexing UX (unchanged)
  chat/page.tsx                     production chat page
  chat-assist-ui/page.tsx            assistant-ui reference/testing chat page
  library/, library/[id]/            existing dummy-data library (unchanged)
src/components/
  assistant-ui/thread.tsx           /chat's Thread
  assistant-ui/thread-assist-ui.tsx  /chat-assist-ui's Thread
  assistant-ui/tool-call.tsx          shared ghost/collapsible tool-call UI
  assistant-ui/thinking-indicator.tsx  shared "waiting for first token" indicator
  app-shell.tsx                     nav: Chat / Chat (assistant-ui) / Library / Index
.agents/skills/frontend-ui-conventions/SKILL.md   design tokens + patterns reference
```

## Migrating this MVP to production-grade

1. **Auth.** Nothing is gated right now.
2. **Postgres over SQLite** once there's more than one concurrent writer — the driver-adapter
   pattern in `src/lib/prisma.ts` makes this a matter of swapping `@prisma/adapter-better-sqlite3`
   for `@prisma/adapter-pg` (or similar) plus the `datasource` provider, not a rewrite.
3. **Background indexing worker**, not a manual button on `/make-science`.
4. **Semantic search** — `searchArticles` is still plain SQL `contains`, per your instruction to
   skip Qdrant for now. The tool's interface (query in, ranked results out) doesn't need to
   change when you swap the implementation.
5. **Rate limiting + cost controls** on `/api/chat` and `/api/articles/index`.
6. **CI-driven `prisma generate`**, not relying on `postinstall` alone.
