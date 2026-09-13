# Frontend UI Conventions — locaul science

A reference for keeping this project's UI consistent with claude.ai's actual design language,
and for what's available if we reach for Radix Themes components later. Read this before making
UI changes to `/chat`, `/chat-assist-ui`, `/library`, `/make-science`, `/make-science-gemma4`,
`/make-embedding`, `/recent`, or the `(auth)` login/signup pages.

## Design tokens (source of truth: `src/app/globals.css`)

All colors are CSS variables in HSL triplet form (`H S% L%`, no `hsl()` wrapper), consumed via
Tailwind's `hsl(var(--x) / <alpha-value>)` pattern so every color utility supports opacity
modifiers (`bg-background/50`, `border-border/60`, etc).

**There are four layers, and you almost always want the fourth.** This structure is copied from
claude.ai's own stylesheet rather than invented here:

1. `--cds-hsl-*` — the raw CDS scale (`gray-0` … `gray-900`, `red-*`, `blue-*`, `clay`, …).
   Mode-independent facts about the palette. **Never reference these from a component**, and
   never redefine them per-theme.
2. `--_gray-800`, `--_brand-clay`, … — private aliases; one indirection so a palette swap only
   has to move this layer.
3. `--bg-100`, `--text-400`, `--border-100`, `--accent-brand`, … — CDS *semantic* tokens,
   redefined per mode. This is the layer that changes between light and dark.
4. `--background`, `--card`, `--foreground`, … — this app's role names, each mapping onto a
   layer-3 token. **This is what `tailwind.config.ts` reads and what components should use.**

Adding a color means picking an existing layer-1 step and giving it a layer-4 role — not
writing a new hex value.

Two token sets, swapped by the `.dark` class on `<html>` (via `next-themes`, `attribute="class"`):

| Token               | Light                  | Dark                        | Use                                                    |
| ------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------- |
| `--background`      | `--bg-100` (gray-20)     | `--bg-100` = gray-800, `#20201f` | Page background, chat viewport |
| `--sidebar`          | = `--background`          | gray-810, `#1e1e1d`            | In light mode identical to `--background` (separated by a thin border, as claude.ai does it). In dark mode a hair darker, per the design brief. |
| `--card`            | `--bg-000` (white)       | gray-750, `#2c2c2a`            | Elevated surfaces only: the composer/message box, cards that need to pop |
| `--user-message`     | `--bg-300`               | gray-750, `#2c2c2a`            | The user's chat bubble — same surface as the composer |
| `--foreground`      | gray-900                  | gray-20, `#f9f9f7`             | Primary text (`--text-100`) |
| `--muted-foreground` | `--text-400`             | gray-350                       | Secondary text, metadata, placeholders |
| `--border`           | gray-90                   | gray-650                       | **Usually used at reduced opacity** (`border-border/60`, `/70`). Note this deliberately diverges from CDS's own `--border-100` (gray-100, a *light* grey used at very low alpha in dark mode) — this project paints borders at full strength in enough places that the faithful token would glow. `--border-100` is still defined if you want it with your own alpha. |
| `--accent`           | clay-emphasized           | clay (`#d97757`)               | The terracotta brand color, from CDS `--accent-brand` |
| `--destructive`      | red-450                   | red-400                        | Errors only |
| `--success` / `--warning` / `--info` | green/yellow/blue-450 | green-400 / yellow-200 / blue-350 | Status only — pipeline states on `/make-embedding`. Reach for these instead of raw Tailwind `text-green-500` etc. |

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
- **Progress** — **implemented** as `src/components/ui/progress.tsx`, also hand-rolled. Pass
  `value={null}` for the indeterminate variant: it's used on `/make-embedding` for a page whose
  chunk count isn't known yet, where a 0% bar would wrongly read as "stuck". Prefer this over a
  bare `<div style={{width}}>` so the ARIA attributes come along for free.
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

For layout behavior across viewport widths (breakpoints, the hamburger-vs-pill-row decision,
what "responsive" actually requires beyond a `hidden md:flex` class), see
`../responsive-design/SKILL.md`. For the database/auth/API architecture, see
`../backend-architecture/SKILL.md`. For the AI SDK chat pipeline, model switching, tools, and the
agent-activity timeline, see `../ai-chat-architecture/SKILL.md`. All four are meant to be read
together when working on anything chat-related — the UI conventions here assume the
data/streaming behavior documented in the other two, and any layout work should also follow the
responsive-design file.
