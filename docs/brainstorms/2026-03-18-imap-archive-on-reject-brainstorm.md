# IMAP Archive on Screen Out — Brainstorm

**Date:** 2026-03-18
**Status:** Ready for planning

## Problem

When a user screens out (rejects) a sender in Kurir, the messages are correctly marked as archived in the database (`isArchived: true`), but they remain in the IMAP inbox. This means the user's actual IMAP inbox accumulates "junk" emails that should have been moved to the IMAP archive folder.

Additionally, when new messages arrive from already-rejected senders during sync, they are archived in the DB but never moved on the IMAP server — the IMAP inbox keeps growing with unwanted mail.

## What We're Building

Two-part fix:

1. **Bug fix:** `rejectSender()` already calls `moveToArchiveViaImap()` via `after()`, but the IMAP move never actually works. Debug and fix the root cause (likely: wrong UID query, `after()` not executing, or archive folder not found).

2. **Sync-time IMAP move:** During IMAP sync, when a message from a REJECTED sender is processed, collect its UID and batch-move all rejected-sender messages to the IMAP archive at the end of the sync pass. This keeps the IMAP inbox clean going forward.

## Why This Approach

- **Approach A (inline during sync)** was chosen over post-sync cleanup or server-side filters
- Reuses existing `moveToArchiveViaImap()` infrastructure (batched moves, echo suppression)
- IMAP connection is already available during sync — no extra connection needed
- Simpler than server-side Sieve rules and works with all IMAP servers
- No retroactive cleanup needed — only fix from now on

## Key Decisions

- **IMAP move on reject:** Fix the existing `moveToArchiveViaImap()` call in `rejectSender()` so it actually works
- **IMAP move on sync:** New messages from REJECTED senders should be moved to IMAP archive during sync, not just marked as archived in DB
- **No backlog cleanup:** Existing rejected emails already stuck in IMAP inbox will not be retroactively moved
- **Batch at end of sync:** Collect rejected UIDs during message processing, move in one batch after sync loop completes (efficient, avoids per-message IMAP operations)

## Open Questions

- What is the root cause of `moveToArchiveViaImap()` failing? (Needs debugging — could be after() not running, UID query returning empty, archive folder detection failing, or IMAP connection issues)
- Should echo suppression be used for sync-time moves? (Probably yes, to prevent re-sync of moved messages)
