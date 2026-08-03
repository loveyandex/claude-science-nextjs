# Backend Architecture — locaul science

Read this before touching `src/lib/prisma.ts`, `src/lib/auth.ts`, any `src/app/api/**/route.ts`,
or the `User`/`Chat`/`Article` models in `prisma/schema.prisma`.

## The Python service owns no state; Next.js owns the database

Both pipelines that need Python (`make-science-gemma4`, `make-embedding`) run in `backend/` and
never open a database connection. They push results back over HTTP — `/api/articles-gemma4/
ingest-page` and `/api/embeddings/ingest-progress`, both authenticated with the shared
`X-Internal-Secret` rather than a user JWT (`checkInternalSecret()`, not
`getAuthFromRequest()`). Keeping exactly one writer is what lets the browser watch a run by
polling Postgres, instead of needing a second channel back out of Python.

The corollary for `make-embedding`: **resume state is database state.** `ArticlePage` carries
`embeddingStatus`/`chunkCount`/`embeddedChunks`/`contentHash`, and the Python service is handed
a batch of pages plus their cursors on every call. So "stop a run" just means "stop sending
batches" — there's no job to cancel, and nothing already embedded is lost. If you add a third
pipeline, follow the same shape rather than giving Python its own database credentials.

`contentHash` is the invariant that keeps Qdrant honest: it covers the page text, the chunking
policy *and* the embedding model, so changing the chunk size, changing the model, or
re-transcribing a page all make previously-embedded chunks stop matching, and those pages get
re-embedded with their stale vectors deleted first. Anything that rewrites `ArticlePage.content`
must also reset that page's embedding fields (see the re-transcription branch in
`api/articles-gemma4/ingest-page/route.ts`) — otherwise the page stays marked `embedded`, never
re-enters the queue, and Qdrant keeps serving text that no longer exists.

## Database: Prisma 7 + driver adapters (not the classic `DATABASE_URL` pattern)

Prisma 7 removed the implicit "just set `DATABASE_URL` and go" connection model. Two separate
things now configure the datasource, and it's easy to update one and forget the other:

- **`prisma.config.ts`** (repo root) — read only by the `prisma` CLI (`migrate dev`, `db push`,
  `studio`). Uses `dotenv/config` (side-effect import, loads `.env` since the CLI runs standalone,
  outside Next's own env loading) and `env("POSTGRES_URL")` from `prisma/config` (throws a clear
  error if the var is missing, instead of a confusing downstream connection failure).
- **`src/lib/prisma.ts`** — read by the actual running app. Builds a `PrismaPg` adapter
  (`@prisma/adapter-pg`) from `process.env.POSTGRES_URL` directly and passes it to
  `new PrismaClient({ adapter })`. Prisma 7 requires an explicit adapter — there's no fallback to
  a bare connection string here.

If you ever add a new datasource-affecting setting, it needs to go in *both* places, or CLI
commands and the running app will silently disagree about how to connect.

`schema.prisma`'s `datasource db` block only has `provider = "postgresql"` — no `url` — that's
correct for this pattern, not a bug or an oversight.

**Migrations**: use `npm run db:migrate` (`prisma migrate dev`) for schema changes, not
`db:push`. `db push` is a prototyping tool that doesn't create migration history — fine for the
very first SQLite-era version of this project, wrong now that there's a real Postgres database
with actual user data in it.

## Auth: JWT in localStorage + Authorization header (not cookies)

This was a deliberate choice, made with the tradeoff flagged explicitly: an httpOnly cookie
would be more XSS-resistant (JS literally cannot read it), but the person building this chose the
localStorage + header pattern anyway. If that decision ever gets revisited, here's everything
that would need to change together — it's not a one-line swap:

- `src/lib/auth.ts` — `getAuthFromRequest(req)` reads the `Authorization` header; a cookie-based
  version would read `req.headers.get("cookie")` or use `next/headers`'s `cookies()` instead.
- `src/components/auth/auth-context.tsx` — owns the token in a `useRef` + `localStorage`, exposes
  `authFetch()` (manually attaches the header) and `getToken()` (for the chat transport's own
  `headers` resolver, since that transport does its own fetching outside `authFetch`). A
  cookie-based version wouldn't need any of this — the browser attaches cookies automatically.
- Every protected API route calls `getAuthFromRequest(req)` / `unauthorized()` at the very top.
  This is deliberately repeated per-route rather than centralized in Next.js middleware, **because
  middleware can't read localStorage** — it runs before any client JS executes. Cookie-based auth
  *could* move this into middleware; the current pattern categorically can't.
- `src/components/auth/require-auth.tsx` — client-side page gate (skeleton while checking,
  redirect to `/login` if no valid session). This is *only* a UX nicety, not real protection —
  the actual protection is the per-route `getAuthFromRequest` check above. Don't ever add a page
  under `(app)/` and assume `RequireAuth` alone protects its data; the API route it calls needs
  its own check too (this bit us once already — see the `/api/articles/*` routes, which were
  gated on the page level before being gated on the API level in a follow-up pass).

No email verification (explicit choice — signup hashes + creates the account immediately). No
refresh tokens — a single 7-day JWT, no revocation path short of rotating `JWT_SECRET` (which
logs out every user). Fine for local/trusted use; the first thing to add before anything wider.

## Chat persistence: JSON blob, not a normalized message table

`Chat.messages` is a single `Json` column holding the *entire* `UIMessage[]` array (AI SDK v7's
parts-based format — text, reasoning, and tool-call parts, in order), not a separate `Message`
table with one row per message. This was a deliberate simplicity choice: it makes "save the whole
turn" and "load the whole conversation" both single-row operations, and it's what
`toUIMessageStreamResponse`'s `onEnd` hands back anyway — no reshaping needed. The tradeoff: you
can't efficiently query "find all messages containing X" across chats without a full scan / a
Postgres JSON path query. Not a problem yet at personal-history scale; would be the first thing
to reconsider if this ever needed cross-chat search.

**The `ensureMessageIds()` gotcha** (`src/lib/message-ids.ts`): some assistant messages come back
from `onEnd` with `id: ""` under certain multi-step tool-calling turns (observed, not fully
root-caused — see the skill file's own comments for what was actually verified vs. inferred).
assistant-ui's runtime uses `message.id` as an internal store key, so duplicate/empty ids
silently collapse to the last message sharing that id. Every write path (`onEnd` in
`api/chat/route.ts`) and every read path (`GET /api/chats/[chatId]`) runs messages through
`ensureMessageIds()` before they're persisted or handed to the client. **If you add a new way to
read or write `Chat.messages`, route it through this function too** — it's cheap (no-ops if ids
are already fine) and skipping it silently reintroduces the "only the last message shows after
reload" bug.

## API route conventions

Every route under `src/app/api/` that touches user data follows this shape, top to bottom:

```ts
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  // ownership check, if the route operates on a specific resource:
  const thing = await prisma.thing.findUnique({ where: { id } });
  if (!thing || thing.userId !== auth.sub) {
    return Response.json({ error: "Not found." }, { status: 404 }); // not 403 — don't leak existence
  }

  // ...actual logic
}
```

A resource that exists but belongs to someone else should return the exact same 404 as one that
doesn't exist at all — see `loadOwnedChat()` in `api/chats/[chatId]/route.ts` for the pattern.

**Pagination**: `GET /api/chats` is the reference implementation — `page`/`limit` query params
(default 20, capped at 50), `skip`/`take` in the Prisma query, and a `{ page, limit, total,
totalPages }` object returned alongside the data. New paginated list endpoints should match this
shape rather than inventing a different one (cursor-based, etc.) so the frontend pagination
component in `/recent` could in principle be reused rather than rewritten per-endpoint.

## Things intentionally left alone (don't "fix" without checking first)

- `Article.status` is a plain `String` ("indexed" | "failed"), not a Postgres enum. This was kept
  as-is during the SQLite→Postgres migration specifically to avoid touching the indexing
  pipeline's business logic, which does plain string comparisons against it throughout.
- `searchArticles` (the chat tool) still does SQL `contains`, deliberately — it's the
  exact-string fallback now that `searchLibrarySemantic` (Qdrant vector search over full page
  text, via `src/lib/qdrant-search.ts`) is the default discovery tool. Don't "upgrade" it to
  vector search; two different matching behaviours is the point.
- `runPythonCode` is off by default (`ENABLE_PYTHON_TOOL`) and is **not sandboxed** beyond a
  timeout + output cap — see the comments in `src/lib/python-runner.ts` before ever turning it on
  outside a trusted single-user environment.
