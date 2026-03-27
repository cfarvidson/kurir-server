---
title: "Iframe body margin collapse truncates email content"
category: ui-bugs
module: mail/thread-view
tags:
  [iframe, css, margin-collapse, scrollHeight, email-body, measurement]
symptoms:
  - "Email body text truncated in thread view"
  - "Sent messages show only one line"
  - "body.scrollHeight returns incorrect value"
  - "iframe wrapper height too small"
date_solved: 2026-03-27
files_changed:
  - src/components/mail/email-body-frame.tsx
---

# Iframe body margin collapse truncates email content

## Problem

Email body content in thread view was truncated. Sent messages showed only ~22px of visible content when they needed ~58px. The iframe wrapper was being sized too small, cutting off text with `overflow: hidden`.

## Root Cause

CSS margin collapse inside the sandboxed iframe used by `EmailBodyFrame`. The `<p>` elements inside the iframe body had default browser margins (`margin: 14px 0`), but the body had `padding: 0 4px` (zero vertical padding). This allowed the paragraph margins to collapse *through* the body element, causing `body.scrollHeight` to report only the text height (22px) without the collapsed margins (~28px missing).

The `EmailBodyFrame` component uses `body.scrollHeight` to set the iframe wrapper height. With the undercount, the wrapper was set to 22px, and `overflow: hidden` clipped the remaining content.

The CSS spec allows margins to collapse through an element when it has zero height, zero vertical padding, and zero vertical border. The body element met all three conditions in the vertical axis, so the child `<p>` margins escaped upward and were not reflected in `scrollHeight`.

## Investigation Journey

This took ~10 iterations to diagnose because the visible symptom ("page scrolls down after reply") was misleading and pointed away from the actual cause:

1. **Removed `scrollIntoView` call** after reply — did not help (was not the cause)
2. **Replaced `autoFocus` with `focus({ preventScroll: true })`** — did not help
3. **Removed `revalidatePath("/", "layout")` from reply action** — did not help
4. **Added scroll position save/restore in ThreadPageContent** — did not help
5. **Continuously tracked scroll via event listener** — did not help
6. **Changed initial iframe height from 200 to 0** — made it worse
7. **Added CSS transition on iframe resize** — still visible shift
8. **Disabled first-measurement transition** — still truncated
9. **Removed Framer Motion AnimatePresence height animation** — removed animation jank but did not fix truncation
10. **Added `overflow-anchor: none`** — did not help
11. **Used Playwright to inspect live DOM** — finally found `body.scrollHeight: 22` with `pMargin: 14px 0`, proving the margin collapse
12. **Added `padding: 4px` to iframe body** — fixed it

The breakthrough came from step 11: instrumenting the actual DOM inside the iframe with Playwright rather than reasoning about the CSS from the outside. The `scrollHeight` value of 22 was the hard evidence that margins were not being counted.

## Solution

One line change in `src/components/mail/email-body-frame.tsx`, in the `BASE_STYLES` constant:

**Before (broken):**

```css
body { padding: 0 4px; max-width: 100%; overflow-x: hidden; }
```

**After (fixed):**

```css
body { padding: 4px; max-width: 100%; overflow-x: hidden; }
```

Changed `padding: 0 4px` to `padding: 4px` — adding 4px of vertical padding prevents `<p>` margins from collapsing through the body element, making `body.scrollHeight` report the correct height including child margins.

Any non-zero vertical padding (even `1px`) would have worked because it breaks the margin collapse condition. Using `4px` keeps the visual spacing consistent with the existing horizontal padding.

## Prevention

1. **When using `body.scrollHeight` for measurement**: Always ensure the body has non-zero vertical padding to prevent child margin collapse. Even `1px` is enough to break the collapse condition.
2. **When debugging "scroll jumps"**: Use Playwright or DevTools to inspect actual DOM measurements (`scrollHeight`, `offsetHeight`, computed styles on child elements) rather than guessing from visual symptoms. The real cause may be upstream in measurement, not in scroll behavior.
3. **CSS margin collapse is invisible in DevTools**: It does not show up in the box model panel. You need to compare `scrollHeight` against expected values calculated from child dimensions + margins to detect it.
4. **Iframe body styles deserve extra scrutiny**: Unlike normal page bodies which usually have padding from a CSS reset, iframe bodies injected via `srcdoc` start with browser defaults (zero padding, zero margin in many resets). Always set explicit vertical padding.

## Related

- CSS spec: [Collapsing margins](https://www.w3.org/TR/CSS2/box.html#collapsing-margins) — margins collapse through elements with zero height, zero padding, and zero border
- `overflow-x: hidden` implicitly sets `overflow-y: auto`, which should create a BFC, but the margin collapse still affected `scrollHeight` measurement in iframe contexts
- `src/components/mail/email-body-frame.tsx` — the iframe component with `BASE_STYLES` and `scrollHeight` measurement
- `src/components/mail/thread-view.tsx` — thread message rendering
- `src/components/mail/thread-page-content.tsx` — thread page with scroll management
- `src/lib/mail/sanitize-html.ts` — HTML sanitization (strips `<style>` tags from emails, so email-provided styles cannot fix the margin issue)
