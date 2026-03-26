---
title: "Fix: Sent messages missing from thread views"
type: fix
date: 2026-02-08
---

# Fix: Sent messages missing from thread views

## Overview

Replies composed in Kurir don't always appear when viewing a thread. Investigation reveals two root causes and one secondary issue that compound to create this bug.

## Problem Statement

When a user sends a reply from within a thread view, the message appears optimistically but may disappear on subsequent visits. Additionally, messages sent via the Compose page (`/compose`) never appear in threads at all until IMAP sync pulls them from the server's Sent folder.

## Root Causes

### 1. Compose page doesn't persist to DB (primary gap)

The `/api/mail/send` route (`src/app/api/mail/send/route.ts`) sends via SMTP but creates **no database record**. The message is invisible to Kurir until the next IMAP sync. The in-thread reply action (`src/actions/reply.ts`) already implements local persistence — the compose route simply doesn't.

### 2. IMAP sync dedup fails when mail server rewrites Message-ID

The sync dedup at `src/lib/mail/sync-service.ts:311-316` matches by exact `messageId`. Some mail servers (Gmail, Exchange) rewrite the Message-ID header. When this happens:

- The locally-persisted reply (negative UID, nodemailer's Message-ID) is never upgraded
- A new record is created with the server's Message-ID
- The thread now has **two copies** of the same reply with different `messageId` values

### 3. Thread dedup prefers the wrong record

In `src/lib/mail/threads.ts:131-138`, dedup keeps the first occurrence by `receivedAt asc`. The locally-created placeholder (negative UID, no `htmlBody`, no sender linkage) is kept over the IMAP-synced version with complete data.

## Proposed Solution

### Phase 1: Persist compose-page messages to DB

**File:** `src/app/api/mail/send/route.ts`

After the SMTP send succeeds (line 64), persist the message to the database following the same pattern as `replyToMessage` in `src/actions/reply.ts:67-112`:

- Find the Sent folder (or create one if absent)
- Save with a negative UID placeholder
- Set `threadId`, `inReplyTo`, `references` from the request body (already accepted by the schema at lines 11-12 but never sent by the Compose UI)
- Call `revalidatePath("/", "layout")`

**File:** `src/app/(mail)/compose/page.tsx`

Pass `inReplyTo` and `references` from URL search params if present (for future reply-from-compose support). For new messages, these remain empty.

### Phase 2: Harden IMAP sync dedup against Message-ID rewriting

**File:** `src/lib/mail/sync-service.ts` (after line 327)

Add a fallback dedup heuristic when exact `messageId` match fails:

```typescript
// Fallback: match by fromAddress + sentAt (±60s) + subject for negative-UID records
if (!localDuplicate) {
  const localByContent = await db.message.findFirst({
    where: {
      userId,
      uid: { lt: 0 },
      fromAddress: fromAddress,
      subject: envelope.subject || null,
      sentAt: {
        gte: new Date((envelope.date?.getTime() || 0) - 60000),
        lte: new Date((envelope.date?.getTime() || 0) + 60000),
      },
    },
  });
  if (localByContent) {
    // Update both UID and messageId to the canonical IMAP version
    await db.message.update({
      where: { id: localByContent.id },
      data: { uid: msg.uid, folderId, messageId: envelope.messageId },
    });
    return localByContent;
  }
}
```

### Phase 3: Fix thread dedup preference order

**File:** `src/lib/mail/threads.ts` (lines 131-138)

When deduplicating by `messageId`, prefer the record with a positive UID (IMAP-synced, complete data) over the negative-UID placeholder:

```typescript
const seen = new Map<string, (typeof allMessages)[0]>();
const deduped = allMessages.filter((m) => {
  if (!m.messageId) return true;
  const existing = seen.get(m.messageId);
  if (existing) {
    // Prefer IMAP-synced record (positive UID) over local placeholder
    if (existing.uid < 0 && m.uid >= 0) {
      seen.set(m.messageId, m);
      return true; // keep this one, the existing will be filtered on next pass
    }
    return false;
  }
  seen.set(m.messageId, m);
  return true;
});
```

## Technical Considerations

- **No-Sent-folder edge case:** If no Sent folder exists in DB (user replies before first sync), `replyToMessage` falls back to any folder via `findFirst`. This should instead create a placeholder Sent folder record.
- **Optimistic UI staleness:** `ThreadPageContent` uses `useState(initialMessages)` which doesn't re-initialize when props change. After `revalidatePath`, the server sends new data but client state is stale. Consider using a `key` prop or `useEffect` sync — but this is a separate UX issue, not the root cause of missing messages.
- **Compose page is for new conversations only:** The Compose UI currently doesn't pass threading headers. This is fine — in-thread replies use `ReplyComposer`. The persistence fix should still set `threadId` from references if provided, for correctness.

## Acceptance Criteria

- [x] Messages sent via `/compose` appear in the Sent page immediately (no waiting for IMAP sync)
- [x] Messages sent via `/compose` appear in thread views after IMAP sync links them
- [x] In-thread replies via `ReplyComposer` always appear in thread detail views after page reload
- [x] When a mail server rewrites Message-ID, the locally-persisted reply is upgraded (not duplicated)
- [x] Thread dedup prefers IMAP-synced records over local placeholders
- [x] No duplicate messages appear in thread views
- [ ] Replying before first IMAP sync stores the message in a valid Sent folder

## Dependencies & Risks

- **Risk:** The fallback dedup heuristic (fromAddress + sentAt + subject) could false-positive on rapid sequential replies with the same subject. Mitigate by also matching on `snippet` or `textBody` prefix.
- **Risk:** Updating `messageId` during sync dedup (Phase 2) could break `inReplyTo` references from subsequent replies that used the original nodemailer Message-ID. The thread unification logic at `sync-service.ts:296-307` should handle this, but needs testing.

## References

- Reply persistence: [reply.ts](src/actions/reply.ts) (lines 67-112)
- Thread fetching: [threads.ts](src/lib/mail/threads.ts) (lines 59-149)
- Compose send route: [route.ts](src/app/api/mail/send/route.ts) (no DB persistence)
- Sync dedup: [sync-service.ts](src/lib/mail/sync-service.ts) (lines 310-327)
- Known issue in MEMORY.md: "Sent messages in Imbox: processMessage must check isInbox param before setting category flags"
- Related commit: `348fa5e` — "Persist sent replies to DB for immediate visibility across all pages"
