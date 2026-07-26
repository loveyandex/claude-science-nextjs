# Project skills index

Three skill files, meant to be read together for anything non-trivial in this repo — each covers
a different layer, and the more interesting changes (chat persistence, the agent-activity
timeline, auth-gated pages) touch all three:

- **`frontend-ui-conventions/SKILL.md`** — design tokens, claude.ai-matched typography, the
  ghost/ no-box tool-call UI, and which Radix Themes components are worth reaching for later.
- **`backend-architecture/SKILL.md`** — Prisma 7's driver-adapter pattern (two config points,
  not one), the localStorage/JWT auth design and its tradeoffs, the chat-persistence JSON-blob
  schema and the `ensureMessageIds()` gotcha, and the auth/ownership-check shape every API route
  follows.
- **`ai-chat-architecture/SKILL.md`** — the model-switching provider setup, the tool roster and
  what adding one more requires, and how the agent-activity timeline (`step-flow.tsx`) is built
  on assistant-ui's real `GroupedParts` API.

This index exists because the three files were added at different points as the project grew
(UI conventions first, backend + AI architecture much later, after auth/persistence/Postgres
landed) — if you're starting fresh on this repo, read all three before making changes, not just
whichever one seems most relevant to the immediate task.
