# Full Reset & Resync

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

A single "Reset Everything" button on the Settings page that wipes all app-side data for a user and re-imports everything from IMAP. Replaces the current two-button (Import + Resync) setup which is confusing and has bugs that prevent resync from working reliably.

After reset, the user starts completely fresh — all senders re-enter the Screener, all messages are re-fetched, and sync state is cleared.

## Why This Approach

- One button is simpler than two (Import vs Resync distinction is confusing)
- If you're resyncing, you likely want a clean slate
- IMAP data is the source of truth — app data is just a cache
- The current resync flow has bugs that silently prevent it from working

## Problems With the Current Flow

1. **Lock contention** — AutoSync polls `/api/mail/sync` every 30s. If a poll is in-flight when the user clicks Resync, the API returns 409 and the user sees a vague alert.
2. **Button permanently disabled** — `triggered` state is set to `true` on click and never resets. If resync fails or errors, the button stays disabled until page refresh.
3. **Two confusing buttons** — Import and Resync side-by-side with subtle behavioral differences. User intent is always "nuke and restart."
4. **Stats stay stale** — Settings page is a server component showing message/sender counts. After data wipe, those stats remain until next navigation.

## Key Decisions

1. **Single button** — Replace Import + Resync with one "Reset Everything" destructive button with confirmation dialog.
2. **Scope: Full nuclear reset** — Delete Messages, Folders, Attachments (cascade), Senders, and reset SyncState. Preserve User record and auth Sessions. IMAP untouched.
3. **Force-release lock before resync** — The resync flow should force-release any existing sync lock before clearing data, so it never gets blocked by a stale or in-progress poll.
4. **Retry on failure** — Reset `triggered` state if the API call fails, so the button is re-clickable.
5. **Refresh page after wipe** — Call `router.refresh()` after the data is cleared so the stats section updates immediately.

## What Changes

### `clearUserMailCache(userId)` in the sync API route

Current behavior:

- `message.deleteMany` (attachments cascade)
- `folder.deleteMany`
- `sender.deleteMany`
- `syncState.update` (reset lastFullSync + syncError)

New behavior:

- Same deletes
- Also `syncState.delete` + recreate (fully reset, including clearing isSyncing lock)

### Settings page UI

- Remove the two `<ImportButton />` components
- Replace with a single "Reset Everything" button (destructive variant)
- Confirmation dialog explaining the consequences
- After successful trigger, dispatch `start-import` event so AutoSync shows progress bar
- If API call fails, re-enable button for retry

### AutoSync compatibility

- No changes needed — once reset triggers the first sync batch and dispatches `start-import`, AutoSync picks up and polls for remaining batches as before.

## Open Questions

None — scope is clear and changes are minimal.
