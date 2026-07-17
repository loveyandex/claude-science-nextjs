# local science

A Next.js (App Router) app: chat with an LLM grounded in your own locally-indexed paper
library, plus a pipeline that reads real PDFs from your article repo, extracts title + abstract
with an LLM, and saves them to a local SQLite database via Prisma.

> Renamed from the earlier "claude / science" MVP — same functionality, new name, real Claude
> palette, and two chat implementations to compare (see below). I read "locaul science" as a
> typo for **"local science"** (fits the app: everything runs against your own local repo/DB) —
> flag it if you meant something else and I'll rename again.

## What's here

- **`/make-science`** — indexing pipeline (unchanged from the last build, per your instructions
  not to touch its features). Diffs your repo's article list against the local DB every visit,
  streams progress while it fetches each PDF, reads the first page, and asks the LLM for a clean
  title + abstract.
- **`/chat`** — the production chat surface. Restyled this pass to actually match claude.ai
  (see "Design system" below) instead of the small-type generic version from before.
- **`/chat-assist-ui`** — a second, fuller chat build following assistant-ui's own published
  ["Claude Clone" reference example](https://www.assistant-ui.com/examples/claude) more
  literally (topic chips, attachment row, edit-message, thumbs up/down). Same `/api/chat`
  backend as `/chat` — this is a testing/comparison surface, not a separate product.
- **`/library`** — the original dummy-data paper search/browse pages, untouched.

Both chat pages call the same `POST /api/chat`, which uses AI SDK v7's `streamText` with a
`searchArticles` tool that queries the **`Article` table directly** (not `ARTICLES_LIST_URL`) —
so chat is grounded in what's actually been indexed via `/make-science`, using just the first
page of each PDF, as you asked.

## Design system (this pass)

The previous version used an approximated "Claude-inspired" palette. This one uses the **actual
token values from claude.ai's own stylesheet** (the CSS you pasted) — `--bg-100/200/000`,
`--text-000/400`, `--accent-brand`, `--danger-100`, etc. — remapped onto this project's existing
Tailwind color names (`background`, `card`, `sidebar`, `foreground`, `muted-foreground`,
`border`, `accent`) in `src/app/globals.css`, so nothing elsewhere in the app (library,
make-science) needed to change to pick up the real colors.

Chat specifically also now uses:

- **`font-serif`** (Source Serif 4 — a stand-in for Anthropic's actual "Anthropic Serif", which
  is a private webfont asset served from Anthropic's own CDN and not something to hot-link into
  a separate app) at **16px body / 1.7 line-height**, not the previous 12–13.5px
- A borderless, rounded composer (`border` only, no shadow) with a big `Sparkle` greeting,
  exactly like claude.ai's empty state
- User messages as a soft rounded bubble (`bg-sidebar`), assistant messages as plain text with
  no bubble/avatar — action icons (copy, thumbs up/down, regenerate) fade in on hover only,
  matching claude.ai's chrome

## Stack

- Next.js 14 (App Router) + TypeScript
- Prisma + SQLite — `Article` model (`prisma/schema.prisma`)
- `unpdf` — extracts text from the first page of each PDF
- Vercel AI SDK **v7** (`ai@7`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) — `streamText`,
  `generateObject`, tool calling
- `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-markdown` — chat
  UI/UX for both `/chat` and `/chat-assist-ui`
- Tailwind + hand-rolled shadcn/ui-style primitives (`src/components/ui/`)

### About the assistant-ui CLI

You linked `npx assistant-ui@latest init` / `npx assistant-ui add thread`. I tried both — the
CLI itself runs fine, but it pulls component source from `r.assistant-ui.com`, which this
sandbox's network allowlist blocks (same restriction that blocks Prisma's engine binaries and
Google Fonts here — none of this is a problem on your machine with normal internet access).

So instead of a manual reconstruction, I fetched the actual published reference source over
`raw.githubusercontent.com` (which *is* allowlisted) — `apps/docs/components/examples/claude.tsx`
from the assistant-ui repo — and adapted that directly for `/chat-assist-ui`, and used the same
primitives/patterns to redo `/chat`'s Thread component. Both are the real
`ThreadPrimitive`/`MessagePrimitive`/`ComposerPrimitive`/`AuiIf` APIs, not a re-implementation.

If you want the literal CLI-scaffolded files (identical result, just fetched a different way),
running this yourself will work since your machine has normal network access:

```bash
npx assistant-ui@latest init
npx assistant-ui@latest add thread
```

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

> **Note on this build:** the sandbox I worked in blocks `binaries.prisma.sh` (Prisma's engine
> download), `r.assistant-ui.com` (the assistant-ui component registry), and your private
> `10.80.31.12` repo, so I couldn't run `prisma generate`, the real CLI, or the actual indexing
> loop against your server here. Everything else typechecks cleanly (`npx tsc --noEmit`) and
> `npm run build` gets through webpack compilation fine — the only remaining error is the
> Prisma-client-not-generated cascade, which resolves the moment you run `npx prisma db push`
> with real network access.

## Project structure

```
prisma/schema.prisma          Article model (SQLite)
src/lib/
  prisma.ts                    Prisma client singleton
  pdf.ts                       first-page text extraction (unpdf)
  ai-provider.ts                shared OpenAI-compatible model from env
  articles-source.ts             fetch repo list + build PDF URLs
src/app/
  api/articles/pending/route.ts   GET  — diff repo list vs DB
  api/articles/index/route.ts      POST — streaming indexing loop
  api/chat/route.ts                POST — streamText + searchArticles tool (Article table)
  make-science/page.tsx             indexing UX (unchanged)
  chat/page.tsx                     production chat page
  chat-assist-ui/page.tsx            assistant-ui reference/testing chat page
  library/, library/[id]/            existing dummy-data library (unchanged)
src/components/
  assistant-ui/thread.tsx           /chat's Thread (Claude-styled: serif, hover actions, sparkle)
  assistant-ui/thread-assist-ui.tsx  /chat-assist-ui's Thread (fuller reference build)
  app-shell.tsx                     nav: Chat / Chat (assistant-ui) / Library / Index
```

## Migrating this MVP to production-grade

Things to do before this is more than a local tool, roughly in priority order:

1. **Auth.** Nothing is gated right now — anyone hitting `/make-science` can trigger indexing,
   and chat has no per-user history/isolation. Add `next-auth`/Clerk/whatever you use elsewhere,
   gate the API routes, and scope `Article`/chat history to a user or workspace.
2. **Swap SQLite for Postgres.** Fine for one process; won't survive concurrent writers or a
   real deployment. Prisma's schema/migrations mostly carry over — mainly changing the
   `datasource` provider and connection string, plus revisiting the `contains` search (Postgres
   gives you `mode: "insensitive"`, which SQLite's connector doesn't support).
3. **Background indexing, not a button.** `/make-science` is manual/click-triggered right now.
   A real deployment wants a cron/queue worker calling the same logic in
   `src/app/api/articles/index/route.ts` until `pendingCount` hits 0, with retries and dead
   letter handling for PDFs that keep failing extraction.
4. **Semantic search.** `searchArticles` is plain SQL `contains` today, per your instruction to
   skip Qdrant for now. When you're ready, this is the first thing to swap for embeddings —
   the tool's interface (query in, ranked results out) doesn't need to change, just what's
   behind it.
5. **Rate limiting + cost controls on `/api/chat` and `/api/articles/index`** — both call an
   LLM per request/per article with no caps right now.
6. **Move the Prisma client generation into CI**, not `postinstall` — `postinstall` running
   `prisma generate` is fine for local dev but you'll want an explicit build step in whatever
   CI/CD you use so a flaky Prisma binary download doesn't fail unrelated deploys.
