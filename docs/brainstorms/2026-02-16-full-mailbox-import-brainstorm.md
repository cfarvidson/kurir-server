# Full Mailbox Import

**Date:** 2026-02-16
**Status:** Ready for planning

## What We're Building

Import all existing messages from an IMAP account (both Inbox and Sent), not just messages that arrive after connecting the account. The current sync already has the right logic (`search({ all: true })` + UID delta), but it tries to process the entire delta in a single HTTP request, which times out or silently fails for large mailboxes (5k-50k messages).

## Why This Approach

**Batched sync with client-side loop** — modify the existing sync to process messages in batches (e.g., 100-200 per call) and return a `hasMore` flag. The client loops calling `/api/mail/sync` until all messages are imported, showing a progress bar.

Why this over alternatives:

- **vs SSE streaming:** Simpler, no long-lived connections, naturally resumable if the browser closes
- **vs separate import endpoint:** No code duplication, the existing sync logic already handles UID delta correctly
- **vs background workers:** Next.js doesn't have native workers; this stays within serverless constraints

The UID delta logic means every call picks up where the last left off — if the browser closes mid-import, the user can resume later and it will skip already-imported messages automatically.

## Key Decisions

1. **Batching**: Add a `batchSize` param to `syncMailbox()`. Process up to N messages per HTTP call, then return with progress stats.
2. **Full bodies**: Fetch `source: true` for every message (not just envelopes). Slower but messages are immediately readable and searchable.
3. **Screener handling**: No special treatment — imported senders go to PENDING like normal. User will triage the screener afterward.
4. **UI locations**:
   - **First-run**: Auto-trigger import when a new account is connected (detect: no existing folders/messages)
   - **Settings**: Manual "Import all messages" button for re-importing or importing after the fact
5. **Progress UI**: Show a progress bar with `synced / total` counts during import.

## Open Questions

- Exact batch size (100? 200? 500?) — to be determined by testing
- Should we show per-folder progress or aggregate?
- Handling of IMAP rate limits from providers (Gmail, Fastmail, etc.)
- Whether to prioritize recent messages first (fetch in reverse UID order) or oldest first
