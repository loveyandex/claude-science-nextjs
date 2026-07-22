# locaul science

A Next.js (App Router) app: chat with an LLM grounded in your own locally-indexed paper
library, plus a pipeline that reads real PDFs from your article repo, extracts title + abstract
with an LLM, and saves them to a local SQLite database via Prisma (v7, driver-adapter pattern).

## What's here

- **`/make-science`** — indexing pipeline (untouched across every pass, per instructions not to
  touch its features). Diffs your repo's article list against the local DB every visit, streams
  progress while it fetches each PDF, reads the first page, and asks the LLM for a clean title +
  abstract.
- **`/chat`** — the production chat surface: claude.ai-matched typography/colors, a model picker
  (gpt-oss / Gemini), a "thinking mode" toggle, and an agent-activity timeline for reasoning +
  tool calls.
- **`/chat-assist-ui`** — a second, fuller chat build following assistant-ui's own
  ["Claude Clone" reference example](https://www.assistant-ui.com/examples/claude) more closely
  (topic chips, attachment row, edit-message, thumbs up/down). Same `/api/chat` backend, same
  model picker and agent-activity timeline as `/chat` — a comparison/testing surface, not a
  separate product.
- **`/library`** — the original dummy-data paper search/browse pages, untouched.

## Model picker + thinking mode

Both chat pages let you switch between two models via a combobox in the composer:

| id | Provider | Env vars |
|---|---|---|
| `gpt-oss` | Your `OPENAI_BASE_URL` (OpenAI-compatible) | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL_NAME` |
| `gemini-flash-lite` | Google Generative AI (`@ai-sdk/google`) | `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_MODEL_NAME` |

The selection (plus a "thinking" toggle) is sent as `{ model, thinking }` in the request body on
every message — `src/lib/ai-provider.ts`'s `getModel(id)` resolves that to a real AI SDK
`LanguageModel`, and `src/app/api/chat/route.ts` passes `thinking` through as
`providerOptions.google.thinkingConfig.includeThoughts` (Gemini-only for now — the tooltip on the
toggle says so; gpt-oss reasoning-effort wiring would need to match whatever your specific
OpenAI-compatible endpoint expects, which isn't standardized the way Gemini's is).

`src/components/assistant-ui/model-context.tsx` holds this as React state shared by both the
picker and the transport, via a stable `getRequestBody()` ref-backed function — so switching
models mid-session doesn't recreate the transport (and drop in-flight state) the way passing a
changing object literal to `DefaultChatTransport({ body })` would.

## Tools (over the local `Article` table, not `ARTICLES_LIST_URL`)

| Tool | Needs a keyword? | Use |
|---|---|---|
| `searchArticles` | yes | keyword search across title/abstract |
| `listRecentArticles` | no | "what's in the library" / browse newest-first |
| `getLibraryStats` | no | indexed/failed counts, most recent indexing activity |
| `getArticleByUrl` | no (needs a url) | pull one article's full record after a search hit |
| `readArticlePage` | no (needs a url + page) | read a specific PDF page — page 1 comes from the cached extraction, other pages are fetched live |
| `webSearch` | yes | real web search via DuckDuckGo's no-JS HTML endpoint, no API key |
| `runPythonCode` | — | **off by default** — runs model-written Python as a real subprocess, see below |

### `runPythonCode` — read this before enabling it

`ENABLE_PYTHON_TOOL=true` turns on a tool that writes whatever Python the model generates to a
temp file and runs it with `python3` as a real OS subprocess (`src/lib/python-runner.ts`). It has
a 10s timeout and an 8000-character output cap — **that is not a security sandbox.** It runs with
the same permissions as your Next.js server process, with filesystem and network access unless
your OS-level setup restricts that. This is fine for a single trusted user running this locally on
their own machine; it is not something to expose on a shared or public deployment without a real
sandbox (a locked-down container, gVisor, a scoped user account, etc.) in front of it. Off by
default for this reason — you have to opt in.

## Agent-activity timeline (reasoning + tool calls)

`src/components/assistant-ui/step-flow.tsx` is the core of the "thinking & actions" UX you asked
for. It uses assistant-ui's `groupPartByType` + `MessagePrimitive.GroupedParts` to coalesce
adjacent reasoning/tool-call parts into one small "working" rail — a `Brain` icon, 10px uppercase
label, then each reasoning step as a muted 12.5px italic line and each tool call as the ghost row
from `tool-call.tsx` — visually distinct (smaller, quieter) from the actual response text, which
renders at full size once the rail ends. This is the same technique the Claude Code transcript
screenshots you shared use (a compact sequence of "Read X" / "Fixed Y" / "Searched Z" rows), built
on assistant-ui's own documented pattern for it rather than something bespoke.

`src/components/assistant-ui/thinking-indicator.tsx` (sparkle + three pulsing dots) is wired in via
`GroupedParts`'s built-in `indicator` slot (default mode `"no-text"`) — it shows automatically
while the model has produced no parts yet or hasn't started a text/reasoning part, and disappears
the instant real content streams in.

## Chat UI fixes this pass

- **App bar**: no border/line separating it from the page — icons and buttons sit directly on
  `bg-background`, matching claude.ai's own minimal top bar. (The icon rail and mobile tab
  switcher got the same treatment earlier.)
- **Typography**: chat message text is `text-base font-normal leading-normal` (1rem / 400 /
  1.5), matching claude.ai's own `.font-claude-response-body` spec you quoted — the previous
  1.7rem line-height and unset weight read as noticeably bigger/heavier than the real thing.
  Centralized in `src/components/assistant-ui/markdown-text.tsx`, shared by both chat pages so
  they can't drift out of sync again.
- **Tool-call UX** (unchanged in *style* per your instruction, extended in *coverage*): the
  ghost/collapsible row from the previous pass now has entries for all seven tools —
  `readArticlePage`, `webSearch`, and `runPythonCode` previously fell through to a raw JSON dump;
  they now get proper icons, human-readable status lines, and formatted results (web results as
  clickable links, Python stdout/stderr in a small mono block, page text in a scrollable snippet).

## Stack

- Next.js 14 (App Router) + TypeScript
- Prisma 7 (driver adapters) + `better-sqlite3` — `Article` model (`prisma/schema.prisma`)
- `unpdf` — first-page extraction for indexing, arbitrary-page extraction for `readArticlePage`
- Vercel AI SDK **v7** (`ai@7`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`, `@ai-sdk/google`) —
  `streamText`, `generateObject`, tool calling, provider switching
- `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-markdown` — chat
  UI/UX for both `/chat` and `/chat-assist-ui`, including the `GroupedParts` agent-activity timeline
- Tailwind + hand-rolled shadcn/ui-style primitives (`src/components/ui/`, now including a Radix
  `Select` for the model picker)

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
ARTICLES_LIST_URL="http://10.80.31.12:3000/articles"
ARTICLES_BASE_URL="http://10.80.31.12:3000"

# Primary LLM (OpenAI-compatible) — also used by /make-science's extraction step
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
MODEL_NAME="gpt-oss-120b"

# Second model option
GOOGLE_GENERATIVE_AI_API_KEY="AIza..."
GEMINI_MODEL_NAME="gemini-3.1-flash-lite"

# Optional, off by default — see the runPythonCode section above before enabling
ENABLE_PYTHON_TOOL="false"
```

> **Note on this build:** the sandbox I worked in blocks `binaries.prisma.sh` (Prisma's
> schema-engine download), `fonts.googleapis.com`, `html.duckduckgo.com` (so `webSearch` is
> written against DuckDuckGo's real HTML but never actually exercised here), and your private
> `10.80.31.12` repo. I could not run `prisma generate`/`db push`, fetch a live search result, or
> run the real indexing loop here. Everything else typechecks cleanly (`npx tsc --noEmit` — down
> to exactly one error, the un-generated `PrismaClient` export) and `npm run build` gets through
> webpack compilation and font handling fine, stopping at that same single Prisma step. Once you
> run `npx prisma db push` locally with real network access, that resolves and the rest proceeds.
>
> One thing worth testing on your end specifically: DuckDuckGo's no-JS HTML endpoint is unofficial
> and its markup could change or rate-limit without warning — if `webSearch` starts returning zero
> results consistently, that's the first thing to check (it degrades to an empty result set rather
> than crashing, so the model will just say it found nothing).

## Project structure

```
prisma/schema.prisma          Article model (SQLite, v7 driver-adapter)
prisma.config.ts               CLI-only datasource URL (Prisma 7 pattern)
src/lib/
  prisma.ts                    PrismaClient + PrismaBetterSqlite3 adapter
  pdf.ts                       first-page extraction (indexing) + arbitrary-page extraction (chat tool)
  ai-provider.ts                model registry + getModel(id) provider switch
  web-search.ts                 DuckDuckGo HTML-endpoint search, no API key
  python-runner.ts               opt-in subprocess Python execution
  articles-source.ts             fetch repo list + build PDF URLs (make-science only)
src/app/
  api/articles/pending/route.ts   GET  — diff repo list vs DB
  api/articles/index/route.ts      POST — streaming indexing loop
  api/chat/route.ts                POST — streamText + 7 tools, model switch, thinking mode
  make-science/page.tsx             indexing UX (unchanged)
  chat/page.tsx                     production chat page (ModelProvider-wrapped)
  chat-assist-ui/page.tsx            assistant-ui reference/testing chat page (same wiring)
  library/, library/[id]/            existing dummy-data library (unchanged)
src/components/
  assistant-ui/thread.tsx           /chat's Thread
  assistant-ui/thread-assist-ui.tsx  /chat-assist-ui's Thread
  assistant-ui/markdown-text.tsx      shared markdown renderer (font fix lives here)
  assistant-ui/step-flow.tsx           agent-activity timeline (GroupedParts)
  assistant-ui/tool-call.tsx            ghost/collapsible tool-call row, all 7 tools
  assistant-ui/thinking-indicator.tsx    "waiting for first token" dots
  assistant-ui/model-context.tsx         shared model/thinking selection state
  assistant-ui/model-picker.tsx           the combobox + thinking toggle
  ui/select.tsx                          Radix Select primitive (shadcn-style)
  app-shell.tsx                     nav: Chat / Chat (assistant-ui) / Library / Index
.agents/skills/frontend-ui-conventions/SKILL.md   design tokens + patterns reference
```

## Migrating this MVP to production-grade

1. **Auth.** Nothing is gated right now.
2. **`runPythonCode` needs a real sandbox** before this goes anywhere multi-tenant — see the
   section above. Don't skip this one.
3. **Postgres over SQLite** once there's more than one concurrent writer — the driver-adapter
   pattern makes this a provider/connection-string swap, not a rewrite.
4. **Background indexing worker**, not a manual button on `/make-science`.
5. **Semantic search** — `searchArticles` is still plain SQL `contains`.
6. **Rate limiting + cost controls** on `/api/chat` and `/api/articles/index` — doubly true now
   that `/api/chat` can also hit a real web search and spin up subprocesses.
7. **CI-driven `prisma generate`**, not relying on `postinstall` alone.
