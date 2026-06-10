# Residual Review Findings — cfarvidson/fix-archive-freeze-and-sync-latency

Source: ce-code-review run `20260610-094454-d0e21175` (mode:autofix, 11 reviewers, 15 findings auto-fixed in commit "fix(review): apply autofix feedback").

The findings below were real but deliberately not fixed in this PR (scope control). Each is filed as a tracker ticket:

- **[P2]** `src/lib/mail/archive-imap.ts:117` — Archive undo TOCTOU: an Undo landing between the pre-move `isArchived` re-check and `persistArchiveLocations` strands the message in the IMAP archive folder while the app shows Imbox (narrow window inside the deferred `after()` execution). → [#61](https://github.com/cfarvidson/kurir-server/issues/61)
- **[P3]** `src/lib/mail/optimistic-archive.ts:116` — Unthreaded-sender sibling rows are not suppressed: the optimistic filter keys per-message for `unthread` senders while `archiveConversation` archives all `threadId` siblings. → [#62](https://github.com/cfarvidson/kurir-server/issues/62)
- **[P2]** `src/components/mail/undo-toast.tsx` — `UndoToastContent` `holdUntil` state machine has no React-level test coverage. → [#63](https://github.com/cfarvidson/kurir-server/issues/63)

Full synthesis (applied fixes, dropped false positives, residual risks): `/tmp/compound-engineering/ce-code-review/20260610-094454-d0e21175/synthesis.md` (session-local).
