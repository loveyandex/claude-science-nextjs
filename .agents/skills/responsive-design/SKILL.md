# Responsive Design — locaul science

Read this before adding or changing anything in `app-shell.tsx`, any page's top-level layout, or
any component that renders a horizontal row of links/tabs/actions. Companion to
`../frontend-ui-conventions/SKILL.md` — that file covers colors/typography/spacing tokens, this
one covers making layouts actually work across viewport widths.

## Why this exists

The header (`src/components/app-shell.tsx`) shipped with a "mobile nav" that was really just the
same desktop link row, gated behind `flex md:hidden`, with no further breakpoint or wrap logic —
it rendered every nav label in one line and simply overflowed the viewport on any phone-width
screen. Separately, the settings page's section sidebar (`hidden sm:block`, no `sm:hidden`
counterpart) made the section switcher completely unreachable below 640px — not broken-looking,
just silently gone. Neither was "responsive," both just had a breakpoint class attached to
otherwise-fixed desktop markup. Both are fixed now (see "Reference implementations" below); this
file exists so the next component doesn't repeat either mistake.

## The core rule

**A breakpoint class is not a responsive design.** `hidden md:flex` / `flex md:hidden` /
`hidden sm:block` only decide *which* of two things renders — they do nothing to guarantee the
thing that renders actually fits or is reachable. Before adding one, answer:

1. **Does the narrow-viewport version actually fit at the smallest width we support (375px, an
   iPhone SE/mini-class device)?** Not "does it fit at 768px" — `md:` triggers *at* 768px and up,
   so anything shown via `md:hidden` has to survive the entire 320–767px range, phones included.
2. **If I `hidden` something at one breakpoint, is there a reachable equivalent below it?** A
   one-way hide with no replacement is a regression, not a responsive layout, even if nothing
   visibly overflows. Grep for the feature's other entry points before assuming "it's fine, they
   can use the desktop layout" — on a phone they can't.
3. **Does this row grow with the data?** A nav/tab list sized for today's item count (5 links) can
   silently start overflowing again the day a 6th item is added, if the "responsive" version was
   just a smaller copy of the same one-line row rather than something that actually collapses.

## Breakpoints (Tailwind defaults, unmodified — `tailwind.config.ts` has no `theme.screens`
override)

| Breakpoint | Width | Rough device class |
| --- | --- | --- |
| (none) | 0–639px | Phones — the floor everything must work at |
| `sm:` | ≥640px | Large phones / small tablets in portrait |
| `md:` | ≥768px | Tablets — this app's one real "chrome" breakpoint (icon rail appears, hamburger disappears) |
| `lg:` | ≥1024px | Small laptops |
| `xl:` / `2xl:` | ≥1280px / ≥1536px | Desktop — unused so far, nothing in this app needs a 3rd column or wider max-width yet |

Stick to `md:` as the one binary "mobile vs. desktop chrome" switch (matches the existing icon
rail / header pattern) unless a specific layout genuinely needs an intermediate `sm:` or `lg:`
step — don't invent a third global breakpoint for chrome, it fragments the mental model of "below
768 = phone layout, at/above = desktop layout."

## Two patterns, pick based on how many items there are

**Overflow-scroll pill row** (`overflow-x-auto` + `scrollbar-thin`, `shrink-0` items) — for a
short, flat list (2–4 items) where every item still deserves to be visible without an extra tap.
Used for the settings page's section switcher (`src/app/(app)/settings/page.tsx`, the `sm:hidden`
nav above the panel content) — cheap, no state, no overlay, and fine for a list that short even if
it did need to scroll.

**Hamburger + dropdown/drawer** — for anything longer (5+ destinations) or that mixes navigation
with actions (logout, theme toggle). Used for the main header (`src/components/app-shell.tsx`'s
`MobileNav`) — a single icon button toggles a `fixed`-backdrop + `absolute`-positioned panel
listing every destination the desktop icon rail carries, so nothing the desktop layout offers
becomes phone-unreachable. Don't build a third pattern (bottom tab bar, hidden overflow menu with
"more") without a real reason — these two cover this app's needs.

Never render a horizontal `flex` row of more than ~4 text-labeled items with no wrap, no
`overflow-x-auto`, and no collapse — that's the exact shape of the bug this file documents.

## Reference implementations (copy the pattern, not just the breakpoint)

- `src/components/app-shell.tsx` — `MobileNav`: hamburger button (`md:hidden`) opens a
  backdrop (`fixed inset-0`, closes on click) + anchored panel (`absolute`, `animate-slide-up`)
  consolidating the desktop icon rail's full destination list (nav items + Recent + Settings +
  Logout) so nothing is lost going from rail to drawer. Desktop rail stays `hidden md:flex`,
  drawer trigger stays `md:hidden` — one breakpoint, two complete layouts, not one layout with a
  piece chopped off.
- `src/app/(app)/settings/page.tsx` — sidebar stays `hidden sm:block`; the `sm:hidden` pill row
  above the content panel is a *complete* replacement (same `SECTIONS` array, same click handler),
  not a stub.

## Touch targets and text at small sizes

- Keep tappable icon buttons at the sizes already used in the shell (`w-8 h-8` / `w-10 h-10`,
  `size={14}`–`size={18}` icons) — don't shrink a mobile-only icon button below that just to save
  space; it's already near the ~40px minimum comfortable tap target and going smaller makes phone
  navigation worse, not better.
- Don't drop below the `text-[12px]`/`text-[11px]` font-mono sizes already used for secondary
  text anywhere on a phone-visible surface — anything smaller stops being legible on a real
  device, screenshots and desktop zoom levels are misleading here.

## How to verify a layout is actually responsive

Don't eyeball it at whatever width the editor/browser happens to be. Check at minimum:

- **375px** (iPhone SE/mini class) — the real floor. If it's clean here, everything above it
  usually is too.
- **768px** (the `md:` boundary, exact) — check both just under and just at/over it, since that's
  where this app's chrome swaps entirely (icon rail ↔ hamburger).
- **1024px+** — confirm the desktop layout doesn't regress; most components here don't have
  anything beyond `md:`, so this mostly just needs a glance.

In this environment, use the Browser pane: `resize_window` with a `width`/`height` (or the
`mobile` preset for 375×812) before screenshotting, and reset to `desktop` when done so you don't
leave the tab pinned to a phone size for later work.
