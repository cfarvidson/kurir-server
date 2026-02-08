---
title: "Sent messages missing from thread views"
date: 2026-02-08
category: integration-issues
tags: [imap, threading, deduplication, sent-messages, message-id-rewriting, prisma, sync, negative-uid, smtp, nodemailer, next-js-cache]
module: mail/sync, mail/threads, actions/reply, api/mail/send
symptoms:
  - Replies composed in thread view disappear on page reload
  - Messages sent via /compose never appear in threads until IMAP sync
  - Duplicate messages appear in thread views after sync
  - Incomplete message data shown (no HTML body, no sender info)
severity: high
---

# Sent messages missing from thread views

## Problem

When a user sends a reply or composes a new message in Kurir, the message appears momentarily but may vanish on subsequent page visits. Messages sent via `/compose` never appear in threads at all until the next IMAP sync pulls them from the server's Sent folder. On certain mail servers (Gmail, Exchange), sync creates duplicate records instead of merging with the existing placeholder.

## Root Causes

Three distinct issues compound to create this bug:

### 1. No immediate DB persistence for compose-page sends

The `/api/mail/send` route sent via SMTP but created **no database record**. The message was invisible to Kurir until IMAP sync ran (potentially minutes later). The in-thread reply action (`reply.ts`) had persistence, but with duplicated inline code.

### 2. IMAP sync dedup fails when mail servers rewrite Message-ID

Sync dedup matched by exact `messageId` only. Some mail servers rewrite the `Message-ID` header on acceptance, so the ID from nodemailer's `sendMail()` doesn't match the ID on the IMAP message. Result: a new record is created alongside the placeholder, causing duplicates.

### 3. Thread dedup prefers the wrong record

When duplicates existed, the thread view dedup kept the first occurrence by iteration order — often the local placeholder with negative UID, incomplete data, and no sender linkage — instead of the IMAP-synced version with full data.

## Solution

### Shared persistence helper (`persist-sent.ts`)

Extracted a shared `createLocalSentMessage()` helper used by both the reply action and compose API route. Key design decisions:

- **Negative UIDs** distinguish local placeholders from IMAP-synced records. Uses `-(Date.now() * 1000 + Math.floor(Math.random() * 1000))` to avoid collisions on rapid sends (the earlier `Date.now() / 1000` approach could collide within the same second).
- **Sent folder lookup** with fallback to any folder if Sent isn't synced yet.
- **Snippet generation** for preview text, also used as a dedup dimension.

```typescript
// src/lib/mail/persist-sent.ts
export function generateTempUid(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

export async function createLocalSentMessage(opts: {
  userId: string;
  messageId: string | null;
  threadId: string | null;
  // ... other fields
}) {
  const folder = await getSentFolder(opts.userId);
  if (!folder) return null;
  return db.message.create({
    data: { uid: generateTempUid(), ...opts, /* defaults */ },
  });
}
```

### Fallback content-based dedup in IMAP sync (`sync-service.ts`)

When exact `messageId` match fails, a fallback heuristic matches by `fromAddress + sentAt (±60s) + subject + snippet` against negative-UID records:

```typescript
if (envelope.date) {
  const snippet = createSnippet(parsed.text);
  const localByContent = await db.message.findFirst({
    where: {
      userId,
      uid: { lt: 0 },
      fromAddress,
      subject: envelope.subject || null,
      ...(snippet ? { snippet } : {}),
      sentAt: {
        gte: new Date(envelope.date.getTime() - 60000),
        lte: new Date(envelope.date.getTime() + 60000),
      },
    },
    orderBy: { sentAt: "desc" },
  });
  if (localByContent) {
    const oldMessageId = localByContent.messageId;
    const newMessageId = envelope.messageId || undefined;
    await db.message.update({
      where: { id: localByContent.id },
      data: { uid: msg.uid, folderId, messageId: newMessageId },
    });
    // Cascade: update inReplyTo refs pointing to the old messageId
    if (oldMessageId && newMessageId && oldMessageId !== newMessageId) {
      await db.message.updateMany({
        where: { userId, inReplyTo: oldMessageId },
        data: { inReplyTo: newMessageId },
      });
    }
  }
}
```

The `inReplyTo` cascade is critical: without it, subsequent replies that referenced the old nodemailer Message-ID would become orphaned from the thread.

### Thread dedup with UID preference (`threads.ts`)

The dedup now explicitly prefers IMAP-synced records (positive UID) over local placeholders (negative UID):

```typescript
const seen = new Map<string, Message>();
for (const m of allMessages) {
  if (!m.messageId) continue;
  const existing = seen.get(m.messageId);
  if (!existing || (existing.uid < 0 && m.uid >= 0)) {
    seen.set(m.messageId, m);
  }
}
const deduped = allMessages.filter(
  (m) => !m.messageId || seen.get(m.messageId) === m
);
```

### Two-pass thread query

Pass 1 finds messages by `threadId`, `messageId`, and `inReplyTo`. Pass 2 catches sent messages whose `threadId` wasn't unified by querying for any message whose `inReplyTo` points to a message found in Pass 1. This handles the case where a sent reply exists in the DB but its threadId doesn't match the thread being viewed.

### Supporting changes

- **DB indexes**: Added `@@index([userId, uid])` and `@@index([userId, inReplyTo])` for the new query patterns.
- **Cache invalidation**: Wrapped sidebar count queries in `unstable_cache` with `revalidateTag("sidebar-counts")` called from all mutating actions.
- **Shared navigation config**: Extracted duplicated nav array from sidebar components into `navigation.ts`.

## Key Patterns

1. **Sentinel values for placeholders**: Negative UIDs let you distinguish local records from synced records in any query, without an extra boolean column.
2. **Multi-strategy reconciliation**: Primary dedup by exact identifier, fallback by content heuristic. Never rely on a single identifier in federated systems.
3. **Cascade identifier updates**: When a canonical ID changes, propagate to all foreign-key-like references (`inReplyTo` in this case).
4. **Preference-based dedup**: When duplicates exist, encode explicit rules for which version to keep (complete > placeholder).
5. **Multi-pass thread assembly**: Don't assume all thread metadata is consistent; use multiple query strategies to recover all members.

## Prevention

- When building optimistic update patterns, always plan the reconciliation path at design time — not as an afterthought.
- Email Message-IDs are not stable across servers. Any system that persists Message-IDs must handle rewrites.
- Add composite DB indexes for new query patterns at the same time as the queries, not later.
- Pair `unstable_cache` with `revalidateTag` in every server action that mutates the cached data.

## References

- Plan: [docs/plans/2026-02-08-fix-sent-messages-missing-from-threads-plan.md](../../plans/2026-02-08-fix-sent-messages-missing-from-threads-plan.md)
- Shared helper: [src/lib/mail/persist-sent.ts](../../../src/lib/mail/persist-sent.ts)
- Sync dedup: [src/lib/mail/sync-service.ts](../../../src/lib/mail/sync-service.ts) (lines 310-365)
- Thread assembly: [src/lib/mail/threads.ts](../../../src/lib/mail/threads.ts) (lines 59-155)
- Commits: `348fa5e`, `0df420c`, `7d47fc9`
- MEMORY.md note: "Sent messages in Imbox: processMessage must check isInbox param before setting category flags"
