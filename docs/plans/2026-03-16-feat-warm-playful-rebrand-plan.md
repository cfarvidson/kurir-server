---
title: Warm & Playful Rebrand with New Logo
type: feat
date: 2026-03-16
deepened: 2026-03-16
---

# Warm & Playful Rebrand with New Logo

## Enhancement Summary

**Deepened on:** 2026-03-16
**Key improvements from research:**
1. Primary coral darkened from `56%` to `44%` lightness for WCAG AA compliance (4.6:1 contrast with white)
2. Complete dark mode warm variable set with lower saturation (avoids garish dark backgrounds)
3. Warm-tinted shadow system using hue 25 instead of pure black
4. Destructive color shifted to `355` hue to stay visually distinct from coral primary

## Overview

Replace the current purple-themed design with a warm coral/terracotta/amber palette inspired by the new Kurir logo. Create an SVG logo component from the provided image and update all color variables, auth pages, and UI surfaces to feel warm and playful.

## Proposed Solution

### 1. Create SVG Logo Component

**New file:** `src/components/logo.tsx`

Create a React component rendering the stylized "K" logo as inline SVG. The logo consists of 4 organic rounded shapes:
- **Top-left:** Coral/salmon (#E8756A)
- **Middle-right:** Terracotta swooping shape (#C0704A)
- **Bottom-left:** Amber/golden (#DBA044)
- **Bottom-right:** Amber/golden (#DBA044)

Accept `className` prop for sizing (like Lucide icons).

**Implementation details:**
- Use `viewBox="0 0 32 32"` — never hardcode width/height in the SVG
- Accept `className` prop, apply to outer `<svg>` element for Tailwind sizing
- Use `<path>` with cubic bezier curves for organic shapes (not rect/circle)
- Each of the 4 shapes = single `<path>` element
- Add `aria-label="Kurir"` and `role="img"` for accessibility
- Ensure 2px+ gap between shapes at smallest rendered size so they don't merge

### 2. Update CSS Color Variables

**File:** `src/app/globals.css`

#### Light mode (`:root`)

```css
--background: 30 20% 99%;
--foreground: 25 15% 8%;
--card: 30 25% 99.5%;
--card-foreground: 25 15% 8%;
--popover: 30 25% 99.5%;
--popover-foreground: 25 15% 8%;
--primary: 12 76% 44%;          /* Deep coral — 4.6:1 contrast with white (AA pass) */
--primary-foreground: 0 0% 100%;
--secondary: 30 30% 96%;
--secondary-foreground: 25 20% 14%;
--muted: 30 20% 95%;
--muted-foreground: 25 10% 46%;
--accent: 30 30% 96%;
--accent-foreground: 25 20% 14%;
--destructive: 355 80% 52%;    /* Shifted cooler to stay distinct from coral */
--destructive-foreground: 0 0% 98%;
--border: 28 15% 89%;
--input: 28 15% 89%;
--ring: 12 76% 44%;
--radius: 0.75rem;
```

#### Dark mode (`.dark`)

```css
--background: 25 12% 7%;
--foreground: 30 10% 95%;
--card: 25 12% 9%;
--card-foreground: 30 10% 95%;
--popover: 25 12% 9%;
--popover-foreground: 30 10% 95%;
--primary: 12 80% 60%;          /* Lightened for dark bg — ~6:1 contrast */
--primary-foreground: 25 15% 8%;
--secondary: 25 10% 16%;
--secondary-foreground: 30 10% 95%;
--muted: 25 8% 16%;
--muted-foreground: 25 6% 63%;
--accent: 25 10% 16%;
--accent-foreground: 30 10% 95%;
--destructive: 355 70% 42%;
--destructive-foreground: 0 0% 98%;
--border: 25 8% 16%;
--input: 25 8% 16%;
--ring: 12 80% 60%;
```

**Key decisions:**
- Primary `12 76% 44%` passes WCAG AA (4.6:1) with white text
- Dark mode primary lightened to `60%` for readability on dark backgrounds
- Dark mode saturation kept lower than light mode (avoids garish look)
- Destructive shifted to hue 355 (cooler red) so it's visually distinct from coral

### 3. Update Auth Pages

**Files:** `src/app/(auth)/login/page.tsx`, `register/page.tsx`, `setup/page.tsx`

| Change | From | To |
|--------|------|-----|
| Background gradient | `from-purple-50 to-white` | `from-orange-50 via-amber-50/50 to-stone-50/30` |
| Decorative icon | `<Mail>` in `bg-primary/10` circle | `<KurirLogo>` component (sized h-8 w-8) |

The `bg-primary/10` and `text-primary` classes automatically pick up the new coral color.

### 4. Replace Logo in Sidebars

**Files:** `src/components/layout/sidebar.tsx`, `mobile-sidebar.tsx`

Replace the Mail icon + bg-primary square with the KurirLogo component:

```tsx
// Before
<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
  <Mail className="h-4 w-4 text-primary-foreground" />
</div>

// After
<KurirLogo className="h-8 w-8" />
```

Remove `Mail` from lucide imports in both files (no longer used in sidebar).

### 5. Increase Border Radius for Playfulness

**File:** `src/app/globals.css`

| Variable | Current | New |
|----------|---------|-----|
| `--radius` | `0.5rem` | `0.75rem` |

At 0.75rem: `lg` = 12px, `md` = 10px, `sm` = 8px. Comfortable range — beyond 1rem risks pill-shaped small elements.

### 6. Soften Card Shadows

**File:** `src/components/ui/card.tsx`

Change card shadow from `shadow` to `shadow-sm` for a softer feel. The warm-tinted neutrals in borders already give warmth; heavy shadows would fight that.

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/logo.tsx` | **NEW** — SVG logo component |
| `src/app/globals.css` | All CSS variables (primary, neutrals, radius) for light + dark |
| `src/components/layout/sidebar.tsx` | Replace Mail icon with KurirLogo |
| `src/components/layout/mobile-sidebar.tsx` | Replace Mail icon with KurirLogo |
| `src/app/(auth)/login/page.tsx` | Gradient + decorative icon |
| `src/app/(auth)/register/page.tsx` | Gradient + decorative icon |
| `src/app/(auth)/setup/page.tsx` | Gradient + decorative icon |
| `src/components/ui/card.tsx` | Softer shadow |

## Acceptance Criteria

- [ ] SVG logo matches the provided image (4-shape stylized K in coral/terracotta/amber)
- [ ] All purple is gone — primary color is warm coral throughout
- [ ] Primary on white passes WCAG AA (4.5:1 minimum)
- [ ] Background feels warm (off-white with warm undertone, not pure white)
- [ ] Auth pages have warm gradient (not purple-50)
- [ ] Auth pages show the logo mark instead of generic Mail icon
- [ ] Sidebar shows SVG logo instead of purple square with Mail icon
- [ ] Mobile sidebar matches desktop sidebar logo
- [ ] Dark mode still works with warm palette (lower saturation, warm hues)
- [ ] Destructive color visually distinct from primary coral
- [ ] Border radius is slightly larger for playful feel
- [ ] No hardcoded purple references remain in the codebase
- [ ] `pnpm lint` passes

## Implementation Order

1. Create `src/components/logo.tsx` (SVG component)
2. Update `src/app/globals.css` (color variables — everything auto-updates)
3. Update sidebar + mobile sidebar (swap logo)
4. Update auth pages (gradient + decorative icon)
5. Soften card shadow
6. Run lint + verify dark mode

## References

- Logo image: `/Users/cfa/Downloads/t3-chat-generated-image-1773674032589.jpg`
- Current CSS variables: `src/app/globals.css:6-49`
- Sidebar logo: `src/components/layout/sidebar.tsx:56-61`
- Mobile logo: `src/components/layout/mobile-sidebar.tsx:103-107`
- Auth gradient: `src/app/(auth)/login/page.tsx:126`, `register/page.tsx:85`, `setup/page.tsx:171`
- WebAIM Contrast Checker: https://webaim.org/resources/contrastchecker/
- shadcn/ui Theming: https://ui.shadcn.com/docs/theming
