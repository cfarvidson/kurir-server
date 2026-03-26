# Archive Sync & Bulk Archive

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

Two related improvements to how archiving works in Kurir:

### 1. Respect Archive Status During Sync

When syncing historical mail, messages that are archived on the server (exist in All Mail but NOT in INBOX) should be imported directly as archived — not appear in Imbox/Feed/Paper Trail.

**Current behavior:** All synced inbox-type messages get category flags (isInImbox, isInFeed, etc.) and `isArchived = false`, regardless of whether they're actually in the INBOX folder.

**Desired behavior:** During All Mail sync, if a message is not present in INBOX, set `isArchived = true` and skip category flag assignment. The sender still gets tracked/categorized, but the message itself goes straight to the archive view.

**Signal:** IMAP folder membership. If the message exists only in All Mail (not in INBOX), it's archived.

### 2. Bulk Archive in Imbox

Allow selecting and archiving multiple conversations at once from the Imbox view.

**Selection activation (three methods):**

- **Toolbar button** — "Välj" toggle in page header
- **Shift-click** — clicking a row with shift held activates selection mode and selects that row
- **Long-press / right-click** — on a row activates selection mode and selects that row

**UI behavior:**

- Checkboxes are hidden by default — only shown when selection mode is active
- A floating action bar appears when items are selected: "Arkivera (N) konversationer"
- Clicking outside or pressing Escape exits selection mode
- Each selected item is a thread (all messages in the conversation get archived)

**Scope:** Imbox only for now. Can extend to other category views later.

## Why This Approach

### Archive sync via IMAP folder

- The `isInbox` parameter already distinguishes inbox vs non-inbox messages during sync
- We already sync both INBOX and All Mail separately, so we know which folder a message came from
- No need for heuristics like \Seen flag — folder membership is definitive

### Checkboxes + floating action bar for bulk

- Most conventional pattern — users understand it immediately
- Checkboxes hidden by default keeps the UI clean
- Three activation methods cover desktop (shift-click, toolbar, right-click) and mobile (long-press)
- Thread-level selection reuses the existing `archiveConversation` logic

## Key Decisions

1. **IMAP folder as archive signal** — not \Seen flag or other heuristics
2. **Checkboxes hidden by default** — selection mode is opt-in
3. **Three activation methods** — toolbar button, shift-click, long-press/right-click
4. **Thread-level selection** — selecting a row archives the entire conversation
5. **Imbox only** — bulk archive scoped to Imbox for initial implementation
6. **Floating action bar** — appears at bottom when items are selected

## Open Questions

- Should there be a "Select all" option (e.g. checkbox in the list header)?
- Should bulk archive show a confirmation dialog or execute immediately?
- When the sync discovers an archived message, should it still assign a sender category for future messages from that sender?
