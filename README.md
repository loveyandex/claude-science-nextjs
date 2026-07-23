# locaul science

A Next.js (App Router) app: authenticated, per-user chat with an LLM grounded in a locally
indexed paper library, with full chat persistence (resume any conversation, reasoning + tool
calls included, from its own URL), plus the indexing pipeline that builds that library from real
PDFs. Postgres + Prisma 7 (driver adapters) throughout.

## What's new this pass

### Postgres migration
- `prisma/schema.prisma`: `provider = "postgresql"` (was SQLite).
- `prisma.config.ts` reads `POSTGRES_URL` (CLI-only, per the Prisma 7 pattern already in place).
- `src/lib/prisma.ts` uses `@prisma/adapter-pg` — `new PrismaPg(process.env.POSTGRES_URL)`,
  passed to `PrismaClient({ adapter })`.
- `better-sqlite3` and its adapter are fully removed (not kept alongside).

### Auth (Fea2)
Email + password, JWT in **localStorage + `Authorization: Bearer` header** — you specifically
chose this over an httpOnly cookie when I flagged the XSS tradeoff, so: the token *is* readable
by any script that runs on the page (a cookie-based approach would isolate it from JS entirely).
If this ever moves beyond local/trusted use, revisiting that is the first thing I'd suggest.
No email verification, per your call — signup hashes (bcrypt, 12 rounds) and creates the account
immediately.

- `src/lib/auth.ts` — JWT sign/verify (`jose`), password hashing (`bcryptjs`), and
  `getAuthFromRequest(req)` / `unauthorized()` helpers every protected API route uses.
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`.
- `src/components/auth/auth-context.tsx` — client `AuthProvider`: holds the token/user, persists
  to `localStorage`, exposes `login`/`signup`/`logout`, `authFetch()` (attaches the header
  automatically), and `getToken()` (for the chat transport's own header resolver, since that
  transport does its own fetching outside `authFetch`).
- `src/components/auth/require-auth.tsx` — client gate: skeleton while checking, redirects to
  `/login?next=<path>` if there's no valid session.
- **Everything is gated**, per your choice: `(app)/layout.tsx` wraps chat, library, make-science,
  and recent in `RequireAuth`. `(auth)/layout.tsx` (login/signup) is bare — no chrome, and
  redirects *away* to `/chat` if you're already logged in.
- Since auth lives in `localStorage`, Next.js middleware can't see it (middleware runs before any
  JS executes) — gating happens client-side for pages and server-side (Bearer header check) for
  every API route, including the two `/api/articles/*` routes that `/make-science` calls, so the
  UI gate isn't just cosmetic.

### Chat persistence + per-chat URLs (Fea1)
- **`User`** and **`Chat`** models added to the schema. `Chat.messages` stores the *entire*
  `UIMessage[]` array as JSON (`jsonb` on Postgres) — not just text, the full parts sequence:
  reasoning steps, tool calls with their args/results, and text, in order. That's what the
  `StepFlowParts` agent-activity timeline reads to render, so a resumed chat looks identical to
  how it streamed in originally, not collapsed to plain text.
- **Route structure**: `/chat` and `/chat-assist-ui` are now thin entry points
  (`src/components/new-chat-redirect.tsx`) — they create an empty `Chat` row immediately and
  redirect to `/c/[id]` or `/c-assist-ui/[id]`. All the actual chat UI lives at those id-bearing
  routes (`src/components/chat-session.tsx`), which fetch the persisted chat, hydrate
  `useChatRuntime({ id, messages: chat.messages, transport })`, and continue from there.

  *Why redirect immediately rather than only after the first message* (which is what you
  described): navigating to a different route mid-stream would unmount the Thread's runtime and
  interrupt an in-flight response — there's no clean way to change the URL without doing that in
  the App Router without deeper shallow-routing hacks. Creating the row up front avoids that
  entirely, at the cost of an empty "New chat" row if someone visits and leaves without sending
  anything — which `/recent`'s query filters out (`messages: { not: [] }`), so it's invisible in
  practice. Flag it if you'd rather I build the shallow-routing version instead.
- **Persistence itself** happens via AI SDK v7's own mechanism for this —
  `result.toUIMessageStreamResponse({ originalMessages: messages, onEnd: async ({ messages }) =>
  {...} })` — verified against the installed package's types, not guessed. `onEnd` fires once the
  full turn (including every tool call) is done, with the complete updated message list, which
  gets saved back to the `Chat` row along with a title derived from the first user message.
  **This is the only change to `/api/chat/route.ts`** beyond the auth/ownership check at the top
  — the actual model/tool logic (system prompt, all 7 tools) is untouched.
- `POST/GET /api/chats`, `GET/PATCH/DELETE /api/chats/[chatId]` — all auth + ownership checked
  (a `chatId` that exists but belongs to someone else 404s, same as one that doesn't exist).

### `/recent` (Fea3)
Click the search icon in the icon rail (bottom, above logout) → `/recent`: a debounced
title-search box, a paginated list (20/page, server-side `page`/`limit`/`q` params — see
`GET /api/chats` in `src/app/api/chats/route.ts`), skeleton rows while loading, per-row delete,
and click-through to `/c/[id]` or `/c-assist-ui/[id]` depending on which page the chat was
started from (tracked via `Chat.mode`).

## Stack additions this pass

- `@prisma/adapter-pg` + `pg` (Postgres driver adapter, replacing better-sqlite3)
- `jose` (JWT) + `bcryptjs` (password hashing) — both pure JS, no native compilation
- No new UI framework — auth pages and `/recent` reuse the existing hand-rolled `ui/` primitives
  and the `Skeleton` component (`src/components/ui/skeleton.tsx`, new — content-shaped loading
  placeholders per the animation/loading-UX ask, same idea Radix Themes' Skeleton has, hand-rolled
  to match our tokens instead of pulling in the heavier Themes package)

## One-time setup

```bash
npm install
cp .env.example .env   # fill in POSTGRES_URL, JWT_SECRET, and the rest — see below
npx prisma migrate dev --name init   # creates the schema in your Postgres DB
npm run dev
```

Since you're on a real persistent database now (not the SQLite prototyping setup from before),
`prisma migrate dev` (not `db push`) is the right command — it creates a proper migration
history in `prisma/migrations/`, which `db push` deliberately doesn't. `npm run db:migrate` is
an alias for this; `npm run db:push` and `npm run db:studio` are also in `package.json` if you
want the browser-based data viewer.

### `.env` values

```bash
POSTGRES_URL="postgresql://admin:admin@localhost:5432/locaul-science"

JWT_SECRET="change-me-to-a-random-64-char-hex-string"
# generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

ARTICLES_LIST_URL="http://10.80.31.12:3000/articles"
ARTICLES_BASE_URL="http://10.80.31.12:3000"

OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
MODEL_NAME="gpt-oss-120b"

GOOGLE_GENERATIVE_AI_API_KEY="AIza..."
GEMINI_MODEL_NAME="gemini-3.1-flash-lite"

ENABLE_PYTHON_TOOL="false"
```

> **Note on this build:** your Postgres is on your own `localhost:5432` — not reachable from my
> sandbox regardless of network rules, so beyond schema syntax I couldn't exercise a real
> connection, `prisma migrate dev`, or actually sign up/log in/persist a chat end-to-end here. My
> sandbox also blocks `binaries.prisma.sh` (blocks `prisma generate` itself), `fonts.googleapis.com`,
> and `html.duckduckgo.com`. What I *could* and did verify: `npx tsc --noEmit` is clean down to
> exactly one error (the un-generated `PrismaClient` export — resolves the moment you run
> `prisma generate`/`migrate dev` locally), `npm run build` compiles successfully and only fails
> at that same single step, and every non-obvious AI SDK/assistant-ui API used here
> (`toUIMessageStreamResponse`'s `onEnd`, `ChatInit.messages` for hydration,
> `DefaultChatTransport`'s function-valued `body`/`headers`) was checked against the actual
> installed package's `.d.ts` files, not assumed from memory.
>
> Given that, the auth flow (signup → login → token → gated pages → persisted chat → reload
> resumes it) is the one thing I'd most want you to run through end to end first — it's the
> newest, most interconnected piece, and the part I have the least direct confidence in without
> being able to click through it myself.

## Project structure (this pass's additions)

```
prisma/schema.prisma          + User, Chat models (Article unchanged)
src/lib/
  auth.ts                       JWT + password hashing + Bearer-header verification
  prisma.ts                     now uses PrismaPg adapter
src/app/
  (auth)/login, (auth)/signup     bare auth pages, layout redirects away if already logged in
  (auth)/layout.tsx
  (app)/layout.tsx                RequireAuth + AppShell — wraps everything else
  (app)/chat, (app)/chat-assist-ui   thin "create chat + redirect" entry points now
  (app)/c/[chatId]                  the actual /chat UI, hydrated from a persisted Chat
  (app)/c-assist-ui/[chatId]         same, for the assistant-ui reference build
  (app)/recent                      paginated, searchable chat history
  api/auth/{signup,login,me}
  api/chats, api/chats/[chatId]     create/list/get/update/delete, all ownership-checked
  api/chat/route.ts                 + auth check, chatId requirement, onEnd persistence
                                     (tool/model logic itself untouched)
  api/articles/pending, api/articles/index   + auth check (indexing logic untouched)
src/components/
  auth/auth-context.tsx, auth/require-auth.tsx
  chat-session.tsx                 shared hydration + transport wiring for /c and /c-assist-ui
  new-chat-redirect.tsx             shared "create + redirect" for /chat and /chat-assist-ui
  ui/skeleton.tsx                   new
  app-shell.tsx                     + search icon (→ /recent), + logout, fixed a pre-existing
                                     nav-highlight bug (/chat-assist-ui was also lighting up
                                     the /chat icon since "/chat-assist-ui".startsWith("/chat"))
```

## Migrating this further toward production-grade

1. **Reconsider token storage** if this ever isn't single-user/local — httpOnly cookie trades a
   bit of implementation simplicity for real XSS resistance; see the Auth section above.
2. **Rate limit `/api/auth/login`** — nothing currently slows down repeated password guesses.
3. **Refresh tokens** — the JWT is a flat 7-day token right now with no revocation path short of
   rotating `JWT_SECRET` (which logs out everyone). A refresh-token + shorter-lived access-token
   pair is the standard next step.
4. Everything from the previous pass still applies: `runPythonCode` needs a real sandbox before
   any shared deployment, semantic search is still plain SQL `contains`, and rate limiting on
   `/api/chat` itself (now doubly relevant with per-user persistence writes added).
