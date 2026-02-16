---
title: "Sync silently fails on large mailboxes (5k-50k messages)"
date: 2026-02-16
category: performance-issues
tags: [imap, sync, batching, imapflow, progress-ui, react-query, concurrency, syncstate]
module: mail/sync, api/mail/sync, components/mail/auto-sync
symptoms:
  - Sync returns JSON response but imports zero historical messages
  - Only messages arriving after account connection appear in the app
  - Large IMAP accounts (5k-50k messages) never fully sync
  - No error shown to user — sync appears to succeed
severity: high
---

# Sync silently fails on large mailboxes

## Problem

When a user connects an IMAP account with thousands of existing messages, only new messages (arriving after connection) appear in the app. The sync endpoint returns a JSON response quickly but processes zero historical messages. No error is shown — the sync appears to succeed silently.

## Root Cause

`syncMailbox()` in `src/lib/mail/sync-service.ts` fetches `source: true` (full RFC 822 body) for every new message in a single pass. For a mailbox with 50,000 messages, this means downloading every email body in one HTTP request. The request either:

1. Times out (Next.js serverless default ~60s)
2. Runs out of memory holding thousands of parsed emails
3. The IMAP connection stalls under the load

The UID delta logic was correct — `client.search({ all: true })` finds all server UIDs and diffs against cached UIDs. The problem was purely volume: trying to fetch and process the entire delta in one go.

## Solution

### 1. Batched sync via `batchSize` parameter

Added an optional `batchSize` parameter to `syncMailbox()`. When set, it slices the `newUids` array to process only N messages per call:

```typescript
// src/lib/mail/sync-service.ts
const batch = batchSize ? newUids.slice(0, batchSize) : newUids;
const remaining = newUids.length - batch.length;
const batchSet = new Set(batch);
```

The existing `minUid:*` fetch range + filter-in-loop pattern continues to work — we just filter against the smaller `batchSet` instead of all new UIDs.

**Key insight: slice the UID array, not the UID range.** IMAP UIDs are not contiguous (gaps from deleted messages). A range like `MAX(uid)+1:MAX(uid)+200` can return zero messages if there's a gap. Slicing the discovered `newUids` array guarantees exactly `batchSize` messages per batch.

### 2. Extended SyncResult with progress stats

```typescript
interface SyncResult {
  folderId: string;
  newMessages: number;
  errors: string[];
  remaining: number;       // newUids.length - batch.length
  totalOnServer: number;   // allUids.length (from IMAP search)
  totalCached: number;     // existingUids.size + newMessages
}
```

These are computed per-call from the UID delta — not persisted in the database. The client tracks progress ephemerally.

### 3. Atomic concurrency guard with stale lock recovery

The `SyncState` model (already existed in schema but was unused) prevents concurrent IMAP connections:

```typescript
// Atomic claim — no race condition
const claimed = await db.syncState.updateMany({
  where: {
    userId,
    OR: [
      { isSyncing: false },
      { syncStartedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    ],
  },
  data: { isSyncing: true, syncStartedAt: new Date() },
});
```

**Critical detail:** A simple check-then-set (`if (!isSyncing) { set isSyncing = true }`) is a race condition. Two concurrent requests can both read `false` and both proceed. The `updateMany` with a `WHERE` clause is atomic at the database level.

The `syncStartedAt` field auto-expires stale locks after 5 minutes — if the server crashes mid-import, the lock doesn't stay stuck forever.

### 4. Two-mode AutoSync component

`AutoSync` was enhanced from an invisible polling component to a two-mode component:

- **Steady-state:** Invisible, polls every 5s (unchanged behavior)
- **Importing:** When `remaining > 0`, shows a fixed progress bar at screen bottom, polls every 1s with `?batchSize=200`

The transition is automatic — no user action needed. AutoSync detects `remaining > 0` in the sync response and enters import mode. When `remaining === 0` across all folders, it exits import mode and does a `router.refresh()`.

### 5. Deferred `repairThreadIds`

`repairThreadIds()` loads ALL messages for the user into memory and walks `inReplyTo` chains. Running this after every 200-message batch during a 50k import would be catastrophic. The fix: only run it when `remaining === 0` (import complete or normal sync with small delta).

## Key Decisions and Why

| Decision | Reasoning |
|----------|-----------|
| Same endpoint, not separate `/api/mail/import` | One code path. AutoSync already calls `/api/mail/sync` every 5s. Adding a second endpoint means two code paths to maintain and coordinate. |
| `batchSize` as query param, not request body | GET requests work for testing. AutoSync can switch between modes by changing the URL. |
| Progress computed per-call, not persisted in DB | The UID delta IS the progress. `totalOnServer - totalCached = remaining`. No schema migration needed for progress fields. |
| Deferred first-run auto-trigger (YAGNI) | The manual "Import All" button in Settings is sufficient for v1. AutoSync will also naturally detect remaining messages on any page load. |

## Prevention

- When building features that process unbounded collections over network I/O, always design for batching from the start
- IMAP operations downloading full message bodies (`source: true`) are the bottleneck — UID searches and envelope fetches are cheap by comparison
- Always use atomic database operations for distributed locks, not check-then-set patterns
- Add `syncStartedAt` or TTL to any `isSyncing`-style boolean to prevent permanent lock-out on crashes

## Related

- `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md` — negative UID dedup and message-ID rewriting issues (same sync code path)
- MEMORY.md — ImapFlow comma-separated UID bug (use range format `minUid:*`)
