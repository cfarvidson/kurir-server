---
title: Full Reset & Resync
type: refactor
date: 2026-02-19
---

# Full Reset & Resync

Replace the existing "Resync All Messages" with a full nuclear reset that wipes all app-side data (messages, folders, senders, sync state) and re-imports everything from IMAP. User starts fresh — all senders re-enter the Screener.

## Acceptance Criteria

- [ ] `clearUserMailCache` deletes messages, folders, senders and resets sync state — atomically in a transaction
- [ ] User record and auth sessions are untouched
- [ ] IMAP server is untouched — no deletions or flag changes
- [ ] After reset, sync re-imports all messages and senders are recreated with `status: PENDING`
- [ ] Settings page description text updated to reflect new behavior
- [ ] Confirmation dialog warns that sender decisions will be lost
- [ ] GET handler on sync route removed (CSRF fix)

## MVP

### 1. Update `clearUserMailCache` in `src/app/api/mail/sync/route.ts`

Replace sender `updateMany` (reset counts) with `deleteMany`. Reset SyncState fields (don't delete the row — preserve the sync lock). Wrap in a transaction for atomicity.

```typescript
// src/app/api/mail/sync/route.ts

async function clearUserMailCache(userId: string) {
  await db.$transaction([
    db.message.deleteMany({ where: { userId } }),
    db.folder.deleteMany({ where: { userId } }),
    db.sender.deleteMany({ where: { userId } }),
    db.syncState.update({
      where: { userId },
      data: { lastFullSync: null, syncError: null },
    }),
  ]);
}
```

**Why reset SyncState instead of deleting it:** The sync lock is held when this function runs. Deleting the SyncState row means `releaseSyncLock` silently no-ops (updateMany matches zero rows), and AutoSync polling could claim a new lock through the gap, causing concurrent syncs.

### 2. Remove GET handler in `src/app/api/mail/sync/route.ts`

The GET handler delegates to POST, enabling CSRF attacks via `<img src="/api/mail/sync?resync=1">`. Remove it.

```diff
- export async function GET(request: NextRequest) {
-   // Allow GET for easy testing
-   return POST(request);
- }
```

### 3. Update confirmation dialog in `src/components/mail/import-button.tsx`

Change the `window.confirm` message for resync mode:

```typescript
// src/components/mail/import-button.tsx

const confirmed = window.confirm(
  "This will erase all cached mail AND sender decisions, then re-import everything from IMAP. All senders will return to the Screener. Continue?",
);
```

### 4. Update description text in `src/app/(mail)/settings/page.tsx`

Update the help text in the Import section:

```tsx
{/* src/app/(mail)/settings/page.tsx */}

<p className="mt-2 text-sm text-muted-foreground">
  Resync erases all cached mail and sender decisions, then
  re-imports from IMAP. All senders return to the Screener.
</p>
```

## References

- Brainstorm: `docs/brainstorms/2026-02-19-full-reset-resync-brainstorm.md`
- Sync API route: `src/app/api/mail/sync/route.ts:8-22`
- Import button: `src/components/mail/import-button.tsx:18-23`
- Settings page: `src/app/(mail)/settings/page.tsx:100-103`
- Sender upsert (recreates with PENDING): `src/lib/mail/sync-service.ts:49-66`
- SyncState upsert in lock claim: `src/app/api/mail/sync/route.ts:26-30`
