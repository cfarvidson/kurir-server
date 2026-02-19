---
title: "fix: Thread sort order and quoted text collapsing"
type: fix
date: 2026-02-16
---

# Fix Thread Sort Order & Collapse Quoted Text

## Overview

Two improvements to the thread detail view (`/imbox/[id]` and `/archive/[id]`):

1. **Fix message ordering** — Sent messages appear out of chronological position because sorting uses `receivedAt` (IMAP Sent folder's `internalDate`), which can drift from actual send time after deduplication replaces local placeholders. Fix by sorting on `sentAt ?? receivedAt`.

2. **Collapse quoted text** — Replies show redundant `> quoted` lines from earlier messages already visible in the thread. Collapse behind a toggle.

## Problem Statement

### Sort Order

When a user sends a reply, `persist-sent.ts` creates a local placeholder with `sentAt = receivedAt = new Date()` (correct position). On the next IMAP sync, deduplication replaces this placeholder with the Sent folder copy, where `receivedAt` is the IMAP `internalDate` (potentially different from compose time). Since `getThreadMessages()` sorts by `receivedAt`, the sent message shifts position.

### Quoted Text

Email replies include the full quoted body of prior messages. In a thread view where all messages are already displayed, this is redundant noise — especially on mobile. No quote detection or collapsing exists today.

## Proposed Solution

### Feature 1: Sort by `sentAt ?? receivedAt`

Change the final sort in `getThreadMessages()` to always perform an in-memory sort using `sentAt ?? receivedAt` after deduplication and mark-as-read. The Prisma `orderBy` in Pass 1/Pass 2 DB queries can remain `receivedAt` (DB optimization only) — the in-memory sort after dedup is the source of truth.

**Critical implementation detail:** Currently, the in-memory re-sort only runs when Pass 2 finds additional messages (lines 124-128). Single-pass threads return `pass1` directly, still sorted by `receivedAt`. The fix must always re-sort the final `deduped` array regardless of whether Pass 2 found results.

**File:** `src/lib/mail/threads.ts`

### Feature 2: CSS-based Quote Collapsing with Toggle

Use a **CSS-only approach** for HTML emails: wrap the `dangerouslySetInnerHTML` div in a container with a `data-quotes-collapsed` attribute. CSS hides matching selectors (`blockquote`, `.gmail_quote`, `.moz-cite-prefix`) when collapsed. Detect quote presence via regex test on the HTML string (no DOM query needed — the string is available directly).

For **plain text emails**: detect trailing `> ` blocks only (not interleaved inline replies — collapsing those would make the message unintelligible). Split text into original content and trailing quoted block.

**File:** `src/components/mail/thread-view.tsx`

## Acceptance Criteria

### Feature 1: Sort

- [x] Messages in thread view are sorted chronologically by `sentAt ?? receivedAt`
- [x] Sent messages appear in correct position relative to received messages
- [x] Messages with `sentAt = null` fall back to `receivedAt` sorting
- [x] List views (imbox, feed, paper-trail, archive, sent) are NOT affected — they keep `receivedAt desc`
- [x] Reply target (`messages[messages.length - 1]`) reflects the chronologically latest message

### Feature 2: Quote Collapse

- [x] HTML: `<blockquote>`, `.gmail_quote`, `.moz-cite-prefix` elements are hidden when collapsed
- [x] Plain text: trailing `> ` blocks are hidden when collapsed
- [x] Toggle button ("...") appears only when quoted text is detected
- [x] Collapsed by default, user can expand/collapse
- [x] Messages with no quoted text render unchanged (no toggle shown)
- [x] If entire plain text body is quoted, don't collapse (bail out — no toggle)
- [x] Toggle has `aria-label` and `aria-expanded` for accessibility

## Implementation Steps

### Step 1: Fix sort order in `threads.ts`

In `src/lib/mail/threads.ts`:

1. Remove the now-redundant conditional in-memory sort on lines 124-128 (just concatenate `[...pass1, ...pass2]`).
2. After the mark-as-read block (after line 152), add a final sort before returning:

```typescript
// Sort by sentAt (envelope Date header) with receivedAt fallback
return deduped.toSorted(
  (a, b) =>
    (a.sentAt ?? a.receivedAt).getTime() - (b.sentAt ?? b.receivedAt).getTime(),
);
```

Keep the DB `orderBy: { receivedAt: "asc" }` on lines 100 and 120 — it still helps the DB.

Use `toSorted()` (non-mutating) instead of `.sort()` for clarity.

### Step 2: Add quote detection utility

Create `src/lib/mail/quote-utils.ts` for plain text quote detection:

```typescript
export function splitPlainTextQuotes(text: string): {
  body: string;
  quoted: string | null;
} {
  const lines = text.split("\n");
  let quoteStart = lines.length;

  // Walk backwards to find the start of trailing > block
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(">") || lines[i].trim() === "") {
      quoteStart = i;
    } else {
      break;
    }
  }

  // Verify at least one line actually starts with >
  if (!lines.slice(quoteStart).some((l) => l.startsWith(">"))) {
    return { body: text, quoted: null };
  }

  // If entire body is quoted, bail out — nothing to collapse
  if (quoteStart === 0) return { body: text, quoted: null };

  // Check for attribution line ("On ... wrote:") just before the > block
  if (quoteStart > 0 && /^On .+ wrote:\s*$/.test(lines[quoteStart - 1])) {
    quoteStart--;
  }

  const body = lines.slice(0, quoteStart).join("\n").trimEnd();
  const quoted = lines.slice(quoteStart).join("\n");

  return { body, quoted };
}
```

Key fixes from review:

- **Trailing blank line false positive**: verify at least one line starts with `>`
- **Never return `body: null`**: bail out early when `quoteStart === 0` (entire body is quoted)
- **Separate file**: testable independently from the React component

### Step 3: Update `MessageBubble` rendering in `thread-view.tsx`

**For HTML messages:**

Detect quotes via regex on the HTML string (no ref/effect needed):

```tsx
const hasHtmlQuotes =
  /<blockquote|class="gmail_quote"|class="moz-cite-prefix"/.test(
    message.htmlBody ?? "",
  );
const [quotesCollapsed, setQuotesCollapsed] = useState(true);
```

Wrap the `dangerouslySetInnerHTML` div with `data-quotes-collapsed`:

```tsx
<div data-quotes-collapsed={quotesCollapsed && hasHtmlQuotes}>
  <div
    className="prose prose-sm ..."
    dangerouslySetInnerHTML={{ __html: message.htmlBody }}
  />
</div>
```

Add a `<style>` tag scoped inside `MessageBubble`:

```css
[data-quotes-collapsed="true"] blockquote,
[data-quotes-collapsed="true"] .gmail_quote,
[data-quotes-collapsed="true"] .moz-cite-prefix {
  display: none;
}
```

**For plain text messages:**

Use `splitPlainTextQuotes()` to split the body. Render the original portion always, and the quoted portion conditionally:

```tsx
const { body, quoted } = splitPlainTextQuotes(message.textBody ?? "");
```

**Toggle button (shared for both paths):**

```tsx
{
  (hasHtmlQuotes || quoted) && (
    <button
      onClick={() => setQuotesCollapsed(!quotesCollapsed)}
      aria-label={quotesCollapsed ? "Show quoted text" : "Hide quoted text"}
      aria-expanded={!quotesCollapsed}
      className="my-1 flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50"
    >
      <MoreHorizontal className="h-3 w-3" />
    </button>
  );
}
```

## File Change Summary

| File                                  | Change                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/mail/threads.ts`             | Add final `sentAt ?? receivedAt` sort after dedup + mark-as-read; remove redundant intermediate sort |
| `src/lib/mail/quote-utils.ts`         | New — `splitPlainTextQuotes()` utility                                                               |
| `src/components/mail/thread-view.tsx` | Add quote detection, CSS-based HTML collapse, plain text split, accessible toggle UI                 |

## Edge Cases

- **`sentAt` is null**: Falls back to `receivedAt` — no change from current behavior for that message
- **Spoofed/bogus `sentAt`**: Accepted for now (single-user client, low risk). Note: a far-future `sentAt` would become the reply target via `messages[messages.length - 1]`
- **Inline/interleaved quotes in plain text**: Not collapsed — only trailing `>` blocks
- **Trailing blank lines (no quotes)**: Verified via `some(l => l.startsWith('>'))` — no false positive
- **Entire body is quoted**: Plain text bails out (no toggle). HTML: quotes hidden but toggle is right there to expand (same as Gmail)
- **`>` in non-quote context** (e.g., "I want >50"): Only trailing blocks match, minimizing false positives
- **HTML `<blockquote>` used for styling (not quoting)**: CSS hides all blockquotes — accepted for v1 (most email blockquotes ARE quotes)
- **Outlook `-----Original Message-----`**: Not in v1, can add incrementally
- **Non-English attribution lines**: Not detected in v1 — `>` lines still collapse, attribution line stays visible
- **Optimistic reply messages**: Have no quotes (composer doesn't include quoted text), no toggle shown
- **Auto-poll re-render**: Quote collapse state persists in component state (React preserves by `message.id` key)

## Review Feedback Applied

- DHH: Replaced `useRef` + `useEffect` HTML detection with regex string check
- Kieran: Fixed `splitPlainTextQuotes` trailing blank line bug, added accessibility attrs, use `toSorted()`, preserve mark-as-read ordering, extracted to separate file
- Simplicity: Folded "entire body is quoted" into early return, dropped HTML edge case detection

## References

- Brainstorm: `docs/brainstorms/2026-02-16-thread-view-fixes-brainstorm.md`
- Prior learning: `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md`
- Sort logic: `src/lib/mail/threads.ts:59-155`
- Message rendering: `src/components/mail/thread-view.tsx:132-186`
- Thread page (imbox): `src/app/(mail)/imbox/[id]/page.tsx`
- Thread page (archive): `src/app/(mail)/archive/[id]/page.tsx`
