---
title: Archive-Aware Sync & Bulk Archive
type: feat
date: 2026-02-19
revised: 2026-02-19 (post-review)
---

# Archive-Aware Sync & Bulk Archive

## Overview

Two improvements to archiving in Kurir:

1. **Archive-aware sync** — Messages that are archived on the server (in All Mail but not INBOX) should be imported with `isArchived=true` instead of appearing in Imbox/Feed/Paper Trail.
2. **Bulk archive in Imbox** — Select and archive multiple conversations at once via checkboxes + floating action bar.

Brainstorm: `docs/brainstorms/2026-02-19-archive-sync-and-bulk-archive-brainstorm.md`

## Problem Statement

**Sync:** When syncing a Gmail account with 50k messages in All Mail but only 500 in INBOX, all received messages are imported into their category (Imbox/Feed/Paper Trail) regardless of server-side archive status. This floods the user's Imbox with thousands of historically archived messages.

**Bulk archive:** Users can only archive one conversation at a time (hover button). Cleaning up a cluttered Imbox is tedious.

## Proposed Solution

### Part 1: Archive-Aware Sync

**Approach: Leverage the existing dedup check in `syncMailbox`.**

The All Mail sync already skips messages that were previously synced from INBOX (lines 240-246 of `sync-service.ts` — `findFirst` by `messageId`, then `continue`). Any received message that passes this dedup check is, by definition, NOT in the inbox. So the change is minimal: when processing a non-skipped, non-sent message from All Mail, pass `isArchived=true` to `processMessage`.

No `inboxMessageIds` Set needed. No extra DB query. No batching guard. The existing dedup handles it implicitly.

**Implementation in `sync-service.ts`:**

1. Replace the existing `isInbox` logic for All Mail (line 250-254) with archive-aware logic:

```typescript
// REPLACE this line in syncMailbox for specialUse === "all":
//   isInbox = fromAddr !== userEmail.toLowerCase();
// WITH:
const isFromSelf = fromAddr === userEmail.toLowerCase();
if (isFromSelf) {
  // Sent message — existing behavior
  await processMessage(msg, userId, folderId, { isInbox: false, userEmail });
} else {
  // Received message NOT in INBOX (dedup already skipped inbox messages)
  await processMessage(msg, userId, folderId, { isInbox: false, isArchived: true, userEmail });
}
```

2. Refactor `processMessage` to use an options object (avoids 7 positional params with ambiguous booleans):

```typescript
interface ProcessMessageOptions {
  isInbox: boolean;
  userEmail?: string;
  isArchived?: boolean;
}

export async function processMessage(
  msg: FetchMessageObject,
  userId: string,
  folderId: string,
  options: ProcessMessageOptions,
)
```

3. When `isArchived` is true in `processMessage`:
   - Set `isArchived = true` on the message record
   - Set all category flags to `false` (`isInScreener`, `isInImbox`, `isInFeed`, `isInPaperTrail`)
   - Still call `getOrCreateSender` (sender is tracked for future categorization)

**Scope limitation:** This handles initial import and incremental sync of new messages. It does NOT detect messages that leave INBOX between syncs (e.g., archived in Gmail). That's a separate feature (bidirectional sync / INBOX removal detection).

**Known UX tradeoff — Screener pollution:** Importing archived messages from thousands of unique senders will create PENDING sender records. These won't appear in Screener (the messages are archived, not screened), but if a user later receives new mail from one of these senders, the new message goes to Screener rather than being auto-categorized. Auto-approving senders for archived messages is explicitly out of scope — can revisit if this becomes a problem.

**Existing users:** Messages already imported without archive-awareness will NOT be retroactively fixed by this change. A one-time repair script could be built separately if needed.

### Part 2: Bulk Archive

#### Server Action: `archiveConversations`

New server action in `src/actions/archive.ts` (named `archiveConversations` — plural of existing `archiveConversation`, no `bulk` prefix needed):

```typescript
export async function archiveConversations(messageIds: string[]) {
  // 1. Auth check
  // 2. For each messageId, find threadId → collect all thread message IDs
  // 3. Open single IMAP connection
  // 4. suppressEcho for each inbox UID
  // 5. Move all inbox UIDs to archive folder (loop, per-UID try/catch)
  // 6. Single updateMany for all collected message IDs
  // 7. Revalidate sidebar-counts + paths
}
```

The parameter is `messageIds` — the representative message ID from each selected thread row (same as what `archiveConversation` takes today). The action resolves threads internally.

Key design:
- **Single IMAP connection** for all moves (not N connections). Critical for performance.
- **Best-effort per-message:** Each `messageMove` is wrapped in try/catch (same pattern as single archive). If one UID fails, continue with the rest.
- **Single `updateMany`** for all DB flag changes.
- **IMAP move uses per-UID loop**, not comma-separated UIDs (ImapFlow gotcha — comma-separated UIDs are unreliable for `fetch`, and we follow the same caution for `messageMove`).

#### Selection State

Inline `useState` in `InfiniteMessageList` — no separate hook file. Selection mode is derived from state:

```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const isSelectionMode = selectedIds.size > 0;
```

Track by `threadId || message.id` (same key used in the `threads` memo in `infinite-message-list.tsx` line 75). This is stable across data refetches.

**Note:** `ImboxPage` is a server component. Selection state lives in `InfiniteMessageList` (already a client component). The toolbar "Välj" button and `SelectionActionBar` render inside `InfiniteMessageList`, not in the server component.

#### Activation Methods (v1)

| Method | Trigger | Behavior |
|--------|---------|----------|
| Toolbar button | Click "Välj" in list header | Toggle selection mode. When toggled off, clear selection. |
| Shift-click | Shift + click on row | Enter selection mode, toggle clicked row. No range selection in v1. |

**Deferred to v2:** Long-press (mobile touch). Touch event handling conflicts with scroll and needs testing on actual devices.

**Deferred to v2:** Shift-click range selection with anchor tracking. v1 shift-click toggles individual items only.

#### UI Components

**Modified `InfiniteMessageList`:**
- Owns `selectedIds` state
- Renders "Välj" toggle button in a list header area
- Passes `isSelectionMode`, `isSelected`, `onToggleSelect` to each `MessageRow`
- Renders `SelectionActionBar` when `selectedIds.size > 0`
- Handles Escape key to clear selection

**Modified `MessageRow`:**
- Accept `isSelected?: boolean`, `isSelectionMode?: boolean`, `onToggleSelect?: () => void` props
- When `isSelectionMode`: show checkbox, click toggles selection (no navigation)
- When not `isSelectionMode`: existing behavior (click navigates)
- Highlight row background when selected

**New `SelectionActionBar` component** (`src/components/mail/selection-action-bar.tsx`):
- Fixed at bottom center of viewport
- Shows count: "Arkivera (N) konversationer"
- Archive button calls `archiveConversations`
- Loading state during archive (spinner on button)
- Simple show/hide (no animation in v1)
- Clears selection on success

#### Exit Selection Mode

- Press Escape → clear selection
- Click "Välj" toggle off → clear selection
- Navigate away → React state resets naturally
- After successful bulk archive → clear selection

#### No optimistic updates

Rows remain visible with selection styling until the server action completes. Same approach as existing single archive (uses `useTransition` pending state). After completion, `invalidateQueries` refreshes the list.

## Technical Considerations

**IMAP connection reuse for bulk:** The bulk action opens ONE connection and moves all UIDs within a single mailbox lock. Single connection ≈ 2-5s total vs 50 × 2s = unacceptable.

**Echo suppression:** Call `suppressEcho` for each inbox UID before the IMAP moves. Same pattern as single archive but in a loop.

**React Query refetches:** No special handling in v1. The default `staleTime: 30_000` means refetches are infrequent. If a refetch happens during selection, the `threadId`-based selection keys remain stable. If a selected thread disappears (archived by another client), it simply won't match any visible row — harmless.

## Acceptance Criteria

### Part 1: Archive-Aware Sync

- [x] Messages in All Mail that are NOT in INBOX are imported with `isArchived=true`
- [x] Category flags (isInImbox, isInFeed, isInPaperTrail, isInScreener) are all `false` for archived imports
- [x] Sender records are still created/updated for archived messages
- [x] Messages already synced from INBOX are skipped during All Mail sync (existing dedup — no change)
- [x] Sent messages in All Mail behave as before (no change)
- [x] Replace the existing `isInbox` assignment on line ~253 with the new archive-aware branch
- [x] Refactor `processMessage` to use options object instead of positional params
- [x] File: `src/lib/mail/sync-service.ts`

### Part 2: Bulk Archive

- [x] New `archiveConversations(messageIds: string[])` server action in `src/actions/archive.ts`
- [x] Single IMAP connection for all moves in bulk action
- [x] Selection state (`useState<Set<string>>`) in `InfiniteMessageList`
- [x] Toolbar "Välj" button toggles selection mode
- [x] Shift-click on row toggles selection of that row
- [x] Checkboxes appear only when selection mode is active
- [x] `SelectionActionBar` component shows at bottom with count and archive button
- [x] Escape key clears selection
- [x] Selection cleared after successful archive
- [x] `revalidateTag("sidebar-counts")` after bulk archive
- [x] Files: `src/actions/archive.ts`, `src/components/mail/selection-action-bar.tsx`, `src/components/mail/infinite-message-list.tsx`, `src/components/mail/message-list.tsx`

## Dependencies & Risks

- **Gmail-specific behavior:** Gmail's All Mail contains everything. Non-Gmail providers may not have an All Mail folder — the archive-aware logic only applies when a `\All` folder exists.
- **Screener pollution:** Thousands of archived senders created as PENDING. Known tradeoff — see note above.
- **Bulk IMAP moves:** Some providers may rate-limit rapid UID moves. The try/catch per-message pattern handles transient failures gracefully.

## Out of Scope

- Detecting messages that leave INBOX between syncs (bidirectional sync reconciliation)
- Bulk archive in Feed, Paper Trail, or Screener
- "Select all" / "Deselect all" affordance
- Keyboard shortcut ("e") for bulk archive
- Search results selection
- Auto-approve senders for archived messages
- Long-press activation (mobile) — v2
- Shift-click range selection with anchor — v2
- Slide-up animation on action bar — v2
- Migration script for existing users' already-imported messages
- `useSelection` hook extraction (inline state first, extract if reused)

## References

- Brainstorm: `docs/brainstorms/2026-02-19-archive-sync-and-bulk-archive-brainstorm.md`
- Existing archive implementation: `src/actions/archive.ts`
- Sync service: `src/lib/mail/sync-service.ts`
- Message list: `src/components/mail/message-list.tsx`
- Infinite scroll: `src/components/mail/infinite-message-list.tsx`
- Imbox page: `src/app/(mail)/imbox/page.tsx`
- Gmail archive fix: `docs/plans/2026-02-19-fix-gmail-archive-imap-sync-plan.md`
- Batched sync learnings: `docs/solutions/performance-issues/sync-timeout-on-large-mailboxes.md`
