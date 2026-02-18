---
title: "feat: Archive Improvements"
type: feat
date: 2026-02-16
brainstorm: docs/brainstorms/2026-02-16-archive-improvements-brainstorm.md
---

# feat: Archive Improvements

## Overview

Add unarchive support and quick-archive from the message list. Two focused phases that keep the server-first architecture intact — no Zustand, no global state, no swipe gestures. Just server actions + `useTransition` + small client components.

## Problem Statement / Motivation

Currently, archiving only works from inside the Imbox thread detail view. There is no way to unarchive, no quick archive from the list, no keyboard shortcut, and archive is missing from Feed/Paper Trail detail pages.

## Existing Foundation

| Component | Path | Notes |
|-----------|------|-------|
| Archive server action | `src/actions/archive.ts` | Moves IMAP messages to `\Archive`, sets `isArchived: true` |
| Archive button | `src/components/mail/archive-button.tsx` | In Imbox thread detail header only, hardcodes `router.push("/imbox")` |
| Archive list page | `src/app/(mail)/archive/page.tsx` | Lists `isArchived: true` messages |
| Archive detail page | `src/app/(mail)/archive/[id]/page.tsx` | Thread view with no actions |
| DB field + index | `prisma/schema.prisma` | `isArchived Boolean` with `[userId, isArchived]` index |

## Technical Approach

### Prerequisites

#### Extract `withImapConnection` Helper

The existing `archiveConversation` has ~50 lines of IMAP connect/try/catch/finally/logout boilerplate. Adding `unarchiveConversation` would duplicate this. Extract a shared helper first.

```
src/lib/mail/imap-client.ts (new)
```

```typescript
async function withImapConnection<T>(
  userId: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T | null>
```

Handles: credential lookup via `getUserCredentials`, connection, error logging, guaranteed logout. Returns `null` on IMAP failure (matching the current "continue with DB update even if IMAP fails" pattern).

#### Fix `ArchiveButton` Hardcoded Navigation

`src/components/mail/archive-button.tsx` hardcodes `router.push("/imbox")`. Add a `returnPath?: string` prop (defaulting to `"/imbox"`) so it works correctly when placed on Feed and Paper Trail detail pages.

---

### Phase A: Unarchive + Archive on All Detail Pages

**Goal:** Enable unarchiving from the archive detail view and archiving from Feed/Paper Trail detail views.

#### A.1 Server Action: `unarchiveConversation`

```
src/actions/archive.ts (add to existing file)
```

**Signature:** `unarchiveConversation(messageId: string)`

No destination parameter — auto-detect from the sender's category:

1. Auth check + ownership verification (same pattern as `archiveConversation`)
2. Find target message, its `sender`, and all messages sharing its `threadId`
3. Read `sender.category` (`IMBOX` | `FEED` | `PAPER_TRAIL`) to determine destination
4. IMAP: use `withImapConnection` → find Archive mailbox by `specialUse === "\\Archive"` → lock Archive → `messageMove()` UIDs to `INBOX`
5. DB: update all thread messages — `isArchived: false`, set the matching category flag to `true` based on `sender.category`, clear other category flags
6. Revalidate sidebar counts + paths: `/archive`, `/imbox`, `/feed`, `/paper-trail`

**Why auto-detect:** The sender's category is already the source of truth for where messages go. Manually overriding it creates inconsistency — old messages in Imbox while new messages from the same sender go to Feed. Auto-detecting eliminates the destination picker entirely and makes the `e` keyboard shortcut (Phase B) work without a menu.

**IMAP notes:**
- Move always goes Archive → INBOX (IMAP has no concept of app-level categories)
- `folderId`/`uid` staleness: known limitation (same as existing archive). IMAP moves assign new UIDs. Next sync reconciles via message-ID dedup. Document in code comments

#### A.2 Unarchive Button

```
src/components/mail/unarchive-button.tsx (new)
```

- Simple button matching the existing `ArchiveButton` pattern: `useTransition` + server action
- `ArchiveRestore` icon from lucide-react (or `Undo2`)
- On click: call `unarchiveConversation(messageId)`, navigate to `/archive`
- Shows `Loader2` spinner during pending state (same as `ArchiveButton`)
- No destination picker — auto-detect makes this a single-click action

#### A.3 Add Buttons to Detail Pages

```
src/app/(mail)/archive/[id]/page.tsx (modify)
```
- Add `UnarchiveButton` to the thread detail header

```
src/app/(mail)/feed/[id]/page.tsx (modify)
src/app/(mail)/paper-trail/[id]/page.tsx (modify)
```
- Add the existing `ArchiveButton` with `returnPath="/feed"` and `returnPath="/paper-trail"` respectively

---

### Phase B: List-Level Archive + `e` Keyboard Shortcut

**Goal:** Archive from the message list without opening the thread, plus `e` keyboard shortcut on detail pages.

#### B.1 Hover Archive Button on List Rows

```
src/components/mail/message-list.tsx (modify)
```

Minimal change to the existing component:

1. Add `group` class to the existing row `<Link>` wrapper
2. Absolutely position an archive icon button on the right, visible on `group-hover`
3. The button calls `archiveConversation` wrapped in `useTransition`
4. `e.preventDefault()` + `e.stopPropagation()` to prevent `<Link>` navigation
5. During pending state: reduce row opacity (loading indicator) instead of optimistic removal
6. After the server action completes, `revalidatePath` removes the message from the list naturally

**Why no optimistic removal:** The server re-render via `revalidatePath` already handles removing the archived message. Adding optimistic state management (Zustand store, `removedIds`, animation timing vs revalidation race conditions) introduces significant complexity for marginal UX gain. A brief opacity reduction during `useTransition` pending state provides immediate feedback. If users report the brief flash as a problem, optimistic removal can be added later as an isolated enhancement.

**New prop on `MessageList`:**

```typescript
interface MessageListProps {
  messages: Message[]
  basePath?: string
  showArchiveAction?: boolean  // default false
}
```

Pass `showArchiveAction={true}` from Imbox, Feed, and Paper Trail list pages. Not passed from Sent or Archive list pages.

#### B.2 `e` Keyboard Shortcut on Detail Pages

Add an inline `useEffect` to each detail page's client component wrapper. No shared hook — it's ~9 lines:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    if (el.isContentEditable) return;
    if (e.key === "e") handleArchive();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [handleArchive]);
```

Add to:
- `src/app/(mail)/imbox/[id]/page.tsx` — `e` calls `archiveConversation`, navigates to `/imbox`
- `src/app/(mail)/feed/[id]/page.tsx` — `e` calls `archiveConversation`, navigates to `/feed`
- `src/app/(mail)/paper-trail/[id]/page.tsx` — `e` calls `archiveConversation`, navigates to `/paper-trail`
- `src/app/(mail)/archive/[id]/page.tsx` — `e` calls `unarchiveConversation`, navigates to `/archive`

**Note:** Detail pages are currently server components. The `e` shortcut requires a thin client wrapper component (e.g., `ArchiveKeyboardShortcut`) that receives `messageId` and `returnPath` as props. This keeps the page itself as a server component.

---

## Acceptance Criteria

### Phase A: Unarchive + Archive on All Detail Pages
- [x] `unarchiveConversation(messageId)` server action works end-to-end
- [x] Destination auto-detected from `sender.category`
- [x] IMAP messages are moved from Archive mailbox back to INBOX
- [x] DB flags correctly set: `isArchived = false`, correct category flag = `true`
- [x] Unarchive button appears on `/archive/[id]` page
- [x] Archive button appears on `/feed/[id]` and `/paper-trail/[id]` pages with correct `returnPath`
- [x] Sidebar counts update after unarchive
- [x] `withImapConnection` helper extracted and used by both archive and unarchive

### Phase B: List-Level Archive + Keyboard Shortcut
- [x] Hover archive button appears on desktop list rows (Imbox, Feed, Paper Trail)
- [x] Button click archives without navigating away from list
- [x] Row shows pending state (reduced opacity) during archive
- [x] `e` archives current conversation in Imbox/Feed/Paper Trail detail views
- [x] `e` unarchives current conversation in archive detail view
- [x] `e` is suppressed when typing in search input or reply composer
- [x] `ArchiveButton` uses `returnPath` prop, no longer hardcoded to `/imbox`

## Dependencies & Risks

**Dependencies:**
- Phase B depends on the `returnPath` fix to `ArchiveButton` (done in prerequisites)
- Both phases depend on `withImapConnection` helper (done in prerequisites)

**Risks:**
- **IMAP UID staleness:** After archive/unarchive round-trip, stored UIDs may not match IMAP server. Mitigated by message-ID dedup during next sync. Known limitation, documented in code
- **Sender category changes:** If a sender's category changes between archive and unarchive, the unarchived message goes to the new category. This is correct behavior — the sender's current category is the source of truth

## Key Files

### New Files (2)
| File | Purpose |
|------|---------|
| `src/lib/mail/imap-client.ts` | `withImapConnection` helper to reduce IMAP boilerplate |
| `src/components/mail/unarchive-button.tsx` | Unarchive button (matches `ArchiveButton` pattern) |

### Modified Files (7)
| File | Changes |
|------|---------|
| `src/actions/archive.ts` | Add `unarchiveConversation`, refactor `archiveConversation` to use `withImapConnection` |
| `src/components/mail/archive-button.tsx` | Add `returnPath` prop |
| `src/components/mail/message-list.tsx` | Add hover archive button with `showArchiveAction` prop |
| `src/app/(mail)/archive/[id]/page.tsx` | Add `UnarchiveButton` + `e` keyboard shortcut wrapper |
| `src/app/(mail)/feed/[id]/page.tsx` | Add `ArchiveButton` + `e` keyboard shortcut wrapper |
| `src/app/(mail)/paper-trail/[id]/page.tsx` | Add `ArchiveButton` + `e` keyboard shortcut wrapper |
| `src/app/(mail)/imbox/[id]/page.tsx` | Add `e` keyboard shortcut wrapper |

## Future Enhancements (Deferred)

These were discussed in the brainstorm but cut from v1 per review feedback. Each can be added independently later:

- **vim-style j/k list navigation** — requires focus state tracking, `useState` in `MessageList`
- **Bulk selection + action bar** — checkboxes, floating toolbar, batch IMAP operations
- **Swipe-to-archive on mobile** — framer-motion drag gestures, threshold detection
- **Undo toast after archive** — toast notification with undo button
- **`?` key for shortcut help overlay**
- **Archive from Sent page**

## References

- Brainstorm: `docs/brainstorms/2026-02-16-archive-improvements-brainstorm.md`
- Existing archive action: `src/actions/archive.ts`
- IMAP batching learnings: `docs/solutions/performance-issues/sync-timeout-on-large-mailboxes.md`
- Dedup learnings: `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md`
