---
title: "feat: Sent Mail Detail View"
type: feat
date: 2026-02-19
---

# feat: Sent Mail Detail View

## Overview

Clicking a sent message in `/sent` results in a 404 — the route `/sent/[id]/page.tsx` doesn't exist. All other categories (Imbox, Feed, Paper Trail, Archive) have working detail pages. This plan adds the missing detail view plus upgrades the sent list with thread collapsing and recipient display.

> **Note on duplication:** This is the fifth near-identical detail page. All five share ~90% of their code (auth check, thread fetch, reply target logic, JSX layout). Extracting a shared `ThreadDetailPage` component is a natural follow-up but out of scope here.

## Problem Statement

1. **No detail page** — `/sent/[id]` doesn't exist, so every click on a sent message 404s
2. **Flat list** — Sent list shows individual messages, not conversations (no thread collapsing)
3. **Shows "You" as sender** — Every row displays the user's own name instead of the recipient
4. **No reply target for sent-only threads** — If a user opens a sent message with no replies, the reply composer would target themselves

## Proposed Solution

Follow existing category detail page patterns. Two concrete changes:

### 1. Create `/sent/[id]/page.tsx` (Detail Page)

Clone the pattern from `src/app/(mail)/imbox/[id]/page.tsx` with these differences:

- **Back link** → `/sent` (or `/sent?q=...` if search context)
- **Back label** → "Sent"
- **Action button** → `ArchiveButton` (same as Imbox — archives the thread)
- **Reply target for sent-only threads** → Use `toAddresses[0]` of the last message instead of `fromAddress` when no incoming messages exist in the thread. Look up the `Sender` record by recipient email for `displayName`.

**Reply target fix (pseudo-code):**

```typescript
// src/app/(mail)/sent/[id]/page.tsx
const lastIncoming = [...messages]
  .reverse()
  .find((m) => m.fromAddress !== currentUserEmail);

if (lastIncoming) {
  // Normal case: reply to the last person who wrote to us
  replyToAddress = lastIncoming.replyTo || lastIncoming.fromAddress;
  replyToName = lastIncoming.fromName || lastIncoming.fromAddress;
} else {
  // Sent-only thread: reply to the recipient, not yourself
  const recipientEmail = lastMessage.toAddresses[0] || lastMessage.fromAddress;
  replyToAddress = recipientEmail;
  // Look up sender record for display name
  const recipientSender = await db.sender.findFirst({
    where: { userId: session.user.id, email: recipientEmail },
    select: { displayName: true },
  });
  replyToName = recipientSender?.displayName || recipientEmail;
}
```

**Files:**

- **NEW:** `src/app/(mail)/sent/[id]/page.tsx`

### 2. Update Sent List Page (Thread Collapsing + Recipient Display)

Update `src/app/(mail)/sent/page.tsx` to:

**a) Add thread collapsing** — Follow the archive page pattern (`src/app/(mail)/archive/page.tsx`):

- Call `getThreadCounts()` to compute per-thread message counts
- Call `collapseToThreads()` to show one row per conversation
- Pass `threadCount` to each `MessageItem` for the badge
- Note: `threadId` and `toAddresses` are already returned by the existing query (it uses `include`, not `select`)
- Thread counts are cross-folder (consistent with archive) — a thread badge of "5" means 5 messages in the full conversation, not just 5 sent messages

**b) Show recipient instead of sender** — Transform message data before passing to `MessageList`:

- Map `fromName` → recipient's display name (look up from `Sender` table by `toAddresses[0]`, falling back to the raw email)
- Map `fromAddress` → `toAddresses[0]`
- **Set `sender: null`** in the mapping to prevent `MessageList`'s `sender?.displayName` priority from overriding the recipient name
- This keeps `MessageList` unchanged — the transformation is scoped to the sent page

**Files:**

- **MODIFY:** `src/app/(mail)/sent/page.tsx`

## Acceptance Criteria

- [x] Clicking a sent message opens the full thread view at `/sent/{id}`
- [x] Thread shows all messages (sent + received) chronologically
- [x] Reply composer works from the sent detail view
- [x] Reply target is the recipient (not yourself) for sent-only threads
- [x] Sent list groups messages by thread (one row per conversation)
- [x] Sent list shows recipient name/email, not the user's own name
- [x] Thread count badge shows on multi-message conversations
- [x] Back button returns to `/sent` (preserving search context if applicable)
- [x] Archive button in header archives the conversation
- [x] Search within sent still works (flat results, no thread collapsing — consistent with other pages)

## Technical Considerations

- **Mark-as-read side effect**: `getThreadMessages()` marks ALL thread messages as read, including inbox messages. This is consistent with how other detail pages work — accepted tradeoff.
- **Negative UID messages**: Local sent placeholders (negative UID) are safely handled by existing dedup logic in `getThreadMessages()`. `pushFlagsToImap()` skips negative UIDs.
- **No `isInSent` flag**: Sent messages are identified by `folderId`, not a boolean flag. Thread collapsing operates on sent-folder messages only, but detail view shows the full cross-folder thread.
- **Search results stay flat**: Consistent with other pages — search results are not thread-collapsed. Only the default list view collapses.
- **`sender?.displayName` priority chain**: `MessageList` renders `sender?.displayName || fromName || fromAddress`. For sent messages, the `sender` relation points to the user themselves, so we must null it out in the data mapping to let the recipient name show through.

## References

- Brainstorm: `docs/brainstorms/2026-02-19-sent-mail-detail-view-brainstorm.md`
- Pattern source: `src/app/(mail)/imbox/[id]/page.tsx`
- Thread collapsing pattern: `src/app/(mail)/archive/page.tsx`
- Thread retrieval: `src/lib/mail/threads.ts` — `getThreadMessages()`, `collapseToThreads()`, `getThreadCounts()`
- Existing sent list: `src/app/(mail)/sent/page.tsx`
- Related solution: `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md`
