# Gmail Archive Sync Fix

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

Fix the archive write-back so that archiving a message in Kurir actually removes it from Gmail's INBOX.

## The Problem

`archiveConversation()` in `src/actions/archive.ts` looks for a mailbox with `specialUse === "\\Archive"` or `path === "archive"`. Gmail doesn't have either — Gmail's "archive" is simply removing the INBOX label, leaving the message in `[Gmail]/All Mail` (specialUse `\All`).

Result: `archiveBox` is `undefined`, the `if (archiveBox)` guard silently skips the IMAP move, and the message stays in Gmail INBOX.

## Why This Approach

**Gmail IMAP semantics:** Every message lives in `[Gmail]/All Mail`. INBOX is a label. "Archiving" = removing the INBOX label. The IMAP way to do this is `MOVE` from INBOX to `[Gmail]/All Mail`, which strips the INBOX label.

**Fix:** Extend the archive mailbox lookup to fall back to `\All` (Gmail's All Mail) when `\Archive` isn't found. This works for Gmail while preserving the existing behavior for standard IMAP servers that have a real `\Archive` folder.

Same logic applies in reverse for `unarchiveConversation()` — move from `[Gmail]/All Mail` back to INBOX.

## Key Decisions

- **Prefer `\Archive` over `\All`:** Standard IMAP servers with a real archive folder should use it. `\All` is the Gmail-specific fallback.
- **Silent fallback, no provider detection:** No need to detect "is this Gmail?" — just widen the mailbox search.
- **Unarchive needs the same fix:** `unarchiveConversation()` looks for `specialUse: "archive"` in the DB, which also won't match Gmail's All Mail folder.

## Open Questions

- Does the `unarchiveConversation()` DB query for `specialUse: "archive"` match what sync stores for Gmail's All Mail? Need to check what `specialUse` value gets stored in the Folder table during sync.
