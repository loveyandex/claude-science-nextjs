# Frontend UI Conventions — locaul science

A reference for keeping this project's UI consistent with claude.ai's actual design language,
and for what's available if we reach for Radix Themes components later. Read this before making
UI changes to `/chat`, `/chat-assist-ui`, `/library`, `/make-science`, `/recent`, or the
`(auth)` login/signup pages.

## Design tokens (source of truth: `src/app/globals.css`)

All colors are CSS variables in HSL triplet form (`H S% L%`, no `hsl()` wrapper), consumed via
Tailwind's `hsl(var(--x) / <alpha-value>)` pattern so every color utility supports opacity
modifiers (`bg-background/50`, `border-border/60`, etc). Two token sets, swapped by the `.dark`
class on `<html>` (via `next-themes`, `attribute="class"`):

| Token               | Light                  | Dark                        | Use                                                    |
| ------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------- |
| `--background`      | `48 33.3% 97.1%`         | `60 2% 12%` (gray-800)          | Page background, chat viewport, sidebar (same as sidebar) |
| `--sidebar`          | = `--background`          | = `--background`               | **Intentionally identical to `--background`.** Sidebars are separated by a thin border, never a different fill color — that's how claude.ai actually does it. |
| `--card`            | `0 0% 100%` (white)       | `60 3% 21%` (gray-750)          | Elevated surfaces only: composer box, message bubbles that need to pop |
| `--foreground`      | `60 2.6% 7.6%`            | `0 0% 100%`                    | Primary text |
| `--muted-foreground` | `51 3.1% 43.7%`           | `48 5% 57%` (gray-350)          | Secondary text, metadata, placeholders |
| `--border`           | `45 22% 89%`              | `40 2% 26%` (gray-650)          | **Always used at reduced opacity in practice** (`border-border/60`, `/70`) — never full-strength unless the border truly needs to stand out. This is what "thin sidebar border" means: it's opacity, not a 0.5px hack. |
| `--accent`           | `15 63.1% 59.6%`          | `15 63.1% 59.6%`                | The terracotta brand color — same value in both modes, sourced from claude.ai's own `--accent-brand` |
| `--destructive`      | `0 56.2% 45.4%`           | `0 73% 59%`                    | Errors only |

Fonts: `--font-display` (Space Grotesk, headings outside chat), `--font-body` (Inter, UI chrome),
`--font-serif` (Source Serif 4 — chat message text specifically, matching claude.ai's serif body
copy), `--font-mono` (JetBrains Mono, metadata/labels/timestamps).

**Rule of thumb:** if you're tempted to add a new bordered rectangle/card to hold something (a
tool call, a status row, a metadata chip), first ask whether a plain row with an icon + hover
background would read better. claude.ai's chrome is very box-averse — borders mark real
boundaries (composer, message bubble, sidebar edge), not every discrete unit of UI.

## Chat-specific patterns

- **User messages**: rounded bubble, `bg-sidebar` (not `bg-card` — bubbles are a background-tint
  bubble, not an elevated card).
- **Assistant messages**: no bubble, no avatar. Plain text directly on `bg-background`, serif,
  16px/`leading-[1.7rem]`. Action icons (copy/reload/feedback) are invisible until hover
  (`opacity-0 group-hover/message:opacity-100`).
- **Tool calls**: ghost/collapsible row (`src/components/assistant-ui/tool-call.tsx`), not a
  bordered box. Collapsed = one line (icon + status text + chevron). Expand on click for
  args/results. Never dump raw JSON as the default visible state.
- **Waiting for the first token**: `src/components/assistant-ui/thinking-indicator.tsx` — a small
  sparkle + three pulsing dots, shown only while `message.status.type === "running" &&
  message.content.length === 0`. Disappears the instant any part (text or tool call) starts
  streaming.
- **Composer**: rounded-2xl, `border-border/70`, `bg-card`, no shadow beyond a very soft one. No
  placeholder box behind the send button — the button itself is the only "chrome."

## Radix / shadcn conventions used here

This project hand-rolls shadcn-style primitives in `src/components/ui/` (Button, Card, Badge,
Input, Switch) rather than pulling from the shadcn CLI, but follows the same conventions
(`cva` variants, `cn()` merge helper, Radix primitives underneath where interaction/accessibility
matters — e.g. `@radix-ui/react-switch` for the theme toggle).

Radix **Themes** (`@radix-ui/themes`) is a separate, heavier package (a full pre-styled component
library with its own `Theme` provider and token system) that this project does **not** currently
use — we use bare Radix **Primitives** (`@radix-ui/react-*`) plus our own Tailwind styling
instead, to stay consistent with the claude.ai-matched token system above rather than inheriting
Radix Themes' own palette. If a future page needs something Radix Themes covers well and we don't
have a primitive for yet, these are the components to check first before hand-rolling one:

- **Skeleton** — loading placeholders shaped like the content they'll become. **Implemented**
  as `src/components/ui/skeleton.tsx` (hand-rolled to match our tokens, not pulled from Themes)
  — used in `RequireAuth`'s auth-check state, `ChatSession`'s chat-loading state, and `/recent`'s
  list-loading state. Reach for this rather than a spinner for anything that's fetching content
  with a known shape.
  https://www.radix-ui.com/themes/docs/components/skeleton
- **Scroll Area** — custom-styled scrollable regions using native scroll behavior. We currently
  do this with a plain `.scrollbar-thin` utility class; Radix's version would be worth it if we
  need programmatic scroll control (e.g. virtualized chat history).
  https://www.radix-ui.com/themes/docs/components/scroll-area
- **Tooltip**, **Popover**, **Hover Card** — for any future "hover to preview" UI (e.g. hovering
  a citation chip to preview the abstract inline instead of navigating away).
- **Data List** — key/value metadata display; would fit the paper detail page's metadata block
  better than the current ad-hoc flex row if it grows more fields.
- **Segmented Control** — better fit than plain tabs for the mobile Chat/Library/Index switcher
  in `app-shell.tsx` if that ever needs a fourth option and starts feeling cramped.

Full component index: https://www.radix-ui.com/themes/docs/components

## Auth pages and `/recent` — same conventions, different chrome

`(auth)/login`, `(auth)/signup`: no sidebar, no header — just a centered card
(`border-border/70 bg-card`, same composer-style rounding) on the plain `bg-background`. Don't
add app-shell chrome to these; they're intentionally bare (see `(auth)/layout.tsx`).

`/recent`: reuses the same search-input styling as `/library` (`bg-sidebar`,
`border-border/70`, focus:`border-accent`) rather than inventing a new input style — if you add
another searchable list page, match that, not a fresh design.

## This file only covers UI/visual conventions

For the database/auth/API architecture, see `../backend-architecture/SKILL.md`. For the AI SDK
chat pipeline, model switching, tools, and the agent-activity timeline, see
`../ai-chat-architecture/SKILL.md`. All three are meant to be read together when working on
anything chat-related — the UI conventions here assume the data/streaming behavior documented
in the other two.
