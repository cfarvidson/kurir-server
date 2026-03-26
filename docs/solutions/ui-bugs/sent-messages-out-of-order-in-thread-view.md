---
title: "Sent messages appear out of chronological order in thread view"
date: 2026-02-16
category: ui-bugs
tags:
  [
    imap,
    threading,
    sort-order,
    sent-messages,
    receivedAt,
    sentAt,
    deduplication,
    timestamps,
  ]
module: mail/threads, components/mail/thread-view
symptoms:
  - Sent message appears before or after the message it replies to
  - Thread message order looks jumbled after IMAP sync
  - Quoted text in reply references a message that appears below it
severity: medium
---

# Sent messages appear out of chronological order in thread view

## Problem

In the thread detail view (`/imbox/[id]`), sent messages appear in the wrong chronological position. A reply sent at 13:45 might appear after a message received at 13:50, even though the reply was composed first.

## Root Cause

Thread messages were sorted by `receivedAt` (IMAP `internalDate`), which for sent messages reflects when the IMAP Sent folder received its copy — not when the message was actually composed.

The timing sequence:

1. User sends reply → `persist-sent.ts` creates local placeholder with `sentAt = receivedAt = new Date()` (correct position)
2. IMAP sync runs → deduplication replaces placeholder with Sent folder copy (positive UID preferred over negative UID)
3. The Sent folder copy has `receivedAt = msg.internalDate` (IMAP server's timestamp for the Sent folder), which can differ from actual send time
4. Thread sorts by `receivedAt` → sent message shifts position

This is a downstream consequence of the deduplication strategy documented in `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md` — the dedup correctly prefers IMAP-synced records, but the timestamp from the synced record can drift.

## Solution

Sort thread messages by `sentAt ?? receivedAt` instead of `receivedAt`. The `sentAt` field is the envelope `Date:` header — the most accurate timestamp for when a message was actually composed.

### `src/lib/mail/threads.ts`

**Before:**

```typescript
// In-memory sort only ran when Pass 2 found results
if (pass2.length > 0) {
  allMessages = [...pass1, ...pass2].sort(
    (a, b) =>
      new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
  );
}
// ...
return deduped;
```

**After:**

```typescript
// Simple concatenation when Pass 2 finds results (no intermediate sort)
if (pass2.length > 0) {
  allMessages = [...pass1, ...pass2];
}
// ... dedup and mark-as-read ...

// Final sort by sentAt (envelope Date header) with receivedAt fallback
return [...deduped].sort(
  (a, b) =>
    (a.sentAt ?? a.receivedAt).getTime() - (b.sentAt ?? b.receivedAt).getTime(),
);
```

Key details:

- The final sort runs **after** deduplication and mark-as-read (not before)
- DB `orderBy: { receivedAt: "asc" }` in Prisma queries is kept for DB-level optimization
- `sentAt` is nullable (`DateTime?`) — `?? receivedAt` handles null gracefully
- The old code only sorted when Pass 2 found results; single-pass threads were never re-sorted

## Prevention

- When adding sort logic for email messages, prefer `sentAt` (envelope Date header) over `receivedAt` (IMAP internalDate) for chronological ordering
- `receivedAt` is appropriate for list views (newest first in inbox) since it reflects when the server received the message
- `sentAt` is appropriate for thread views where chronological accuracy matters
- After deduplication that replaces local records with server records, always re-sort — the replacement record's timestamps may differ

## Related

- `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md` — the deduplication strategy that causes the timestamp drift
- `src/lib/mail/persist-sent.ts` — local placeholder creation with `sentAt: new Date()`
- `src/lib/mail/sync-service.ts:380` — IMAP sync sets `sentAt: envelope.date || null`
