---
title: "feat: Auto-approve user's own email address"
type: feat
date: 2026-02-19
---

# Auto-Approve User's Own Email Address

## Overview

The user's own email address currently appears as a PENDING sender in the Screener, just like any unknown sender. It should be auto-approved as IMBOX so it never lands in the Screener.

## Problem Statement

`getOrCreateSender()` in `src/lib/mail/sync-service.ts:42-69` always creates new senders with `status: "PENDING"`. It has no knowledge of the user's email address, so the user's own address gets the same treatment as strangers. This causes confusion — why would you need to "approve" yourself?

## Proposed Solution

Thread `userEmail` through the call chain and auto-approve when the sender email matches.

### Changes Required

#### 1. `getOrCreateSender()` — `src/lib/mail/sync-service.ts:42-69`

Add optional `userEmail?: string` parameter. When `email.toLowerCase() === userEmail?.toLowerCase()`:

- **Create path:** Set `status: "APPROVED"`, `category: "IMBOX"`, `decidedAt: new Date()`
- **Update path:** If current status is `PENDING`, upgrade to `status: "APPROVED"`, `category: "IMBOX"`, `decidedAt: new Date()`. If already `APPROVED` or `REJECTED`, leave as-is (respect user's prior decision).

When upgrading from PENDING on the update path, also reclassify existing messages:

```typescript
// Mirror the pattern from approveSender() in src/actions/senders.ts:35-43
await db.message.updateMany({
  where: { senderId: sender.id, isInScreener: true },
  data: {
    isInScreener: false,
    isInImbox: true,
  },
});
```

#### 2. `processMessage()` — `src/lib/mail/sync-service.ts:272`

Add optional `userEmail?: string` parameter. Pass it through to `getOrCreateSender()` at line 301.

#### 3. `syncMailbox()` — `src/lib/mail/sync-service.ts:234`

Pass existing `userEmail` param to `processMessage()` call.

#### 4. IDLE handler — `src/lib/mail/idle-handlers.ts:121-123`

Look up user's email once at the top of `handleNewMessages()`:

```typescript
const user = await db.user.findUnique({
  where: { id: userId },
  select: { email: true },
});
```

Pass `user?.email` to the `processMessage()` call.

## Acceptance Criteria

- [x] User's own email is created as APPROVED/IMBOX on first sync — never appears in Screener
- [x] Pre-existing PENDING sender record for own email is upgraded to APPROVED on next sync
- [x] Pre-existing messages with `isInScreener: true` from own email are reclassified to Imbox
- [x] Self-sent emails arriving via IDLE go to Imbox, not Screener
- [x] Prior user decisions (APPROVED as FEED/PAPER_TRAIL, or REJECTED) are NOT overridden
- [x] Email comparison is case-insensitive
- [x] `decidedAt` is set when auto-approving (not left null)

## Key Design Decisions

- **Only primary email** — no alias/plus-addressing handling (YAGNI)
- **Respect prior decisions** — only upgrade from PENDING, never override APPROVED/REJECTED
- **Self-healing** — the update path handles retroactive fix, no separate migration needed
- **Thread `userEmail` through signatures** — more efficient than a DB lookup per message; only 2 call sites to update

## Files Changed

| File | Change |
|------|--------|
| `src/lib/mail/sync-service.ts` | Add `userEmail` param to `getOrCreateSender()` and `processMessage()`, auto-approve logic |
| `src/lib/mail/idle-handlers.ts` | Look up user email, pass to `processMessage()` |

## References

- Brainstorm: `docs/brainstorms/2026-02-19-auto-approve-own-email-brainstorm.md`
- Sender approval pattern: `src/actions/senders.ts:25-44`
- Contacts exclusion precedent: `src/app/(mail)/contacts/page.tsx:12` (already excludes own email)
