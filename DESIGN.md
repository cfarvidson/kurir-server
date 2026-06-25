# Kurir Design System

The reference for building UI in Kurir. Read this before creating or modifying any
component, page, or layout. The goal is a **calm, focused, editorial** email
experience inspired by Hey.com — never generic "AI slop".

Source of truth for tokens: `src/app/globals.css`. Fonts: `src/app/layout.tsx`.
This file describes intent; the CSS holds the exact values.

## Identity

- **Product**: Kurir — "Email for Humans". A calm, focused inbox.
- **Feel**: warm, paper-like, editorial. Generous whitespace, quiet chrome, content
  first. The interface should disappear behind the message.
- **Anti-goals**: cold blue-grey SaaS dashboards, purple-gradient-on-white AI slop,
  Inter-everywhere flatness, avatar circles, decorative icons-in-a-grid.

## Typography

Three families, each with a job. Never substitute generic fonts (Arial, Roboto,
system-ui as a primary).

| Role | Family | Token | Use |
|------|--------|-------|-----|
| Body / UI | **Inter** (variable) | `font-sans` | All UI text, lists, labels, body copy |
| Editorial display | **Playfair Display** (serif) | `font-serif` | Reading-pane subject headlines — and only sparing, intentional editorial moments |
| Mono | **JetBrains Mono** | `font-mono` | Code, raw headers, technical values |

Playfair is the signature. The 2026-06 "aggressive editorial" redesign **widened
its intentional homes** (this is a deliberate change from the earlier "subject line
and almost nowhere else" rule):

- Open-message subject (the original home)
- **Page mastheads** — every page title, via `PageMasthead`
- **Section headings** in settings / dense surfaces, via `SectionHeading`
- **Empty-state headlines** (already)
- **Editorial figures** — large stat numerals, via `Stat`
- The **auth/onboarding wordmark + headline**

It is still **not** scattered into body copy, labels, buttons, table cells, or list
metadata — those stay Inter. The rule is now "Playfair frames; Inter informs."

### The eyebrow + masthead system

The signature structural move is the **eyebrow**: a small-caps, tracked, uppercase
kicker (`.eyebrow` utility / `text-eyebrow` token) in muted ink, sitting above a
serif title. Every page is framed this way through `PageMasthead`
(`src/components/layout/page-masthead.tsx`): `eyebrow → serif title → meta → hairline`.
Use `SectionHeading` (`src/components/ui/editorial.tsx`) for the in-page echo.

Deploy the full editorial scale deliberately: list subjects use `text-lead`, page
titles `text-title`, hero/auth/empty `text-display`/`headline`. The jump from
`text-sm` body to serif display must be unmistakable. All counts, dates, and sizes
use `tabular-nums`.

## Color

Warm-neutral foundation (hue ~25–30, low saturation) — an off-white "paper"
surface, not cold grey. The accent is a **warm terracotta/rust**, not blue or
purple. Light is the default; dark is a true warm-dark, not slate.

Always use the semantic CSS-variable tokens, never raw hex in components:
`bg-background`, `text-foreground`, `bg-card`, `bg-muted`, `text-muted-foreground`,
`bg-primary`, `border-border`, `bg-secondary`, `bg-accent`, `bg-destructive`, etc.
Both light and dark are defined in `:root` / `.dark` — anything built on these
tokens themes for free.

- **Primary**: warm terracotta (`12 76% 44%` light / `12 80% 60%` dark). Used for
  the one important action, active state, links, focus ring.
- **Surfaces**: `background` (page) → `card`/`popover` (raised) → `sidebar` (a calm
  warm rail, set a touch deeper). Keep elevation subtle.
- **Destructive**: warm red, reserved for delete/irreversible.

### Category colors (Hey.com model)

Each mail category owns a hue. Use the `*-500/600` ramp for accents, lighter steps
for tints/badges. These are fixed scales in `globals.css` — use them, don't invent.

| Category | Hue | Scale prefix |
|----------|-----|--------------|
| Imbox | violet | `imbox-*` (`#7c3aed`) |
| Feed | emerald green | `feed-*` (`#059669`) |
| Screener | red | `screener-*` (`#dc2626`) |
| Paper Trail | amber/orange | `paper-trail-*` (`#ea580c`) |

(The violet here is a category signifier, not a brand gradient — that's the
distinction. Never use it as a page background or button fill.)

## Shape & spacing

- **Radius**: base `--radius: 0.625rem`. Use `rounded-lg/md/sm/xs` (derived from it),
  not arbitrary values. `radius-xs` is for chips, dots, and category rails.
- **Elevation (sharpened)**: app chrome carries **no decorative shadow**. Cards,
  inputs, list rows, the sidebar, the masthead, and the composer get their depth
  from the **surface ramp** (`background → card → sidebar`), **hairline borders**
  (`border-border`), and **whitespace**. The single `shadow-overlay` token is
  reserved for genuinely floating layers — dialog, popover, command palette, mobile
  sheet, toast. Do not reach for `shadow-xs`/`shadow-sm` on resting surfaces; that
  was the old "fake depth" tell and the redesign removes it.
- **Density**: comfortable, not cramped. Whitespace and proportion (padding,
  line-height, alignment) carry the design — fix those before reaching for color.
- **No pill chrome**: counts render as `tabular-nums` numerals, thread counts as
  mono `·N`, categories as a dot/2px rail/faint tint. Filled rounded-pill badges
  as primary chrome are a banned "AI" tell — don't reintroduce them.
- **Unread = a terracotta tick**: unread list rows are marked with a short
  terracotta left rule/tick + foreground weight, not a tinted row fill.

## Motion

Calm and purposeful. Subtle entrances, no bounce, no attention-grabbing loops in
steady state. Use the predefined animations:
`animate-fade-in-up`, `animate-slide-in-right`, `animate-shimmer` (skeletons),
`animate-pulse-slow`. Prefer one well-timed reveal over scattered micro-interactions.

## Components

shadcn-style primitives in `src/components/ui/` (button, card, dialog, input, etc.).
Build new UI by composing these first.

- **Variants**: CVA (`class-variance-authority`) — see `button.tsx` as the canonical
  pattern. Define `variant`/`size` maps + `defaultVariants`.
- **Composition**: Radix primitives + `asChild` via `@radix-ui/react-slot`.
- **Classnames**: always merge through `cn()` from `@/lib/utils`.
- **Icons**: `lucide-react`, sized `size-4` inline by default. Icons support text —
  they don't replace it.
- **Focus**: visible ring via `focus-visible:ring-ring` — never remove focus styles.

## Hard rules

- **No avatars.** No initial-circles, no per-sender images, no small decorative
  thumbnails. Kurir is text-first — sender identity is the name, set in type.
  (Removed app-wide; don't reintroduce.)
- **All UI text in English.**
- **Email body** renders in a sanitized **Shadow DOM** (not an iframe) for CSS
  isolation — don't change the rendering host.
- **Tokens over hex.** If you need a color that isn't a token, add it to
  `globals.css` (both themes) rather than hardcoding.
- **Both themes.** Every new surface must read correctly in light and dark — test
  by toggling `.dark`.

## Quick checklist before shipping UI

- [ ] Uses semantic tokens, works in light **and** dark
- [ ] Body in Inter; Playfair on mastheads/sections/empty/auth/subject — never body/labels/buttons
- [ ] Page chrome uses `PageMasthead` (eyebrow → serif title → hairline)
- [ ] Composes existing `ui/` primitives + `cn()` + CVA where variants are needed
- [ ] Radius/spacing from the scale; **no resting-surface shadow** (ramp + hairline + space)
- [ ] No avatars, no purple gradients, no gradient hero, no icon-in-circle, no pill badges
- [ ] Counts are `tabular-nums`; unread is a terracotta tick; categories are quiet signifiers
- [ ] Focus states visible; terracotta is the only loud accent
