# Full Reset & Resync

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

A "full reset" function that wipes all app-side data for a user and re-imports everything from IMAP. This replaces the existing "Resync All Messages" behavior, which currently preserves sender screening decisions.

After reset, the user starts completely fresh — all senders re-enter the Screener, all messages are re-fetched, and sync state is cleared.

## Why This Approach

- One resync behavior is simpler to maintain and reason about
- If you're resyncing, you likely want a clean slate
- Sender decisions are quick to redo and may need updating anyway
- IMAP data is the source of truth — app data is just a cache

## Key Decisions

1. **Scope: Full nuclear reset of app data** — Delete Messages, Folders, Attachments (cascade), Senders, and SyncState. Preserve User record and auth Sessions.
2. **IMAP untouched** — No deletions, moves, or flag changes on the IMAP server.
3. **Replace existing resync** — Modify `clearUserMailCache` directly rather than adding a parallel function. The current "preserve sender decisions" behavior goes away.
4. **Trigger: Settings page** — Same button location, same batch import flow with progress bar. Just a more thorough clear step.

## What Changes

### `clearUserMailCache(userId)` in the sync API route

Current behavior:
- `message.deleteMany` (attachments cascade)
- `folder.deleteMany`
- `sender.updateMany` (reset messageCount)

New behavior:
- `message.deleteMany` (attachments cascade)
- `folder.deleteMany`
- `sender.deleteMany`
- `syncState.deleteMany`

### Everything else stays the same

- Resync button, confirmation dialog, API route, lock mechanism, batch polling, progress bar — all unchanged.
- `syncUserEmail` already handles missing Folders and SyncState gracefully (creates them on first sync).
- `processMessage` already upserts Senders — they'll be recreated with `status: NEW` and land in Screener.

## Open Questions

None — scope is clear and changes are minimal.
