# Archive Improvements Brainstorm

**Date:** 2026-02-16
**Status:** Ready for planning

## What We're Building

A comprehensive upgrade to the existing archive feature, adding four capabilities:

1. **Archive from list view** — hover button (desktop) + swipe gesture (mobile) to archive directly from the message list without opening the thread
2. **Unarchive support** — move archived conversations back to a user-chosen destination (Imbox, Feed, or Paper Trail), including IMAP move-back from Archive to INBOX
3. **Bulk archive** — checkbox selection mode with a floating action bar for archiving/unarchiving multiple conversations at once
4. **Keyboard navigation** — vim-style j/k to navigate the list, `e` to archive the focused conversation, working in both list and thread detail views

## Why This Approach

**Incremental feature build** — each capability is built as an independent layer, shipping value at each step. This was chosen over building shared selection infrastructure first (too much upfront work before visible features) or server-side-first (no visible progress until UI pass).

### Existing Foundation

The core archive feature is already complete:
- `src/actions/archive.ts` — server action that moves IMAP messages to `\Archive` and sets `isArchived: true`
- `src/components/mail/archive-button.tsx` — button in thread detail header
- `src/app/(mail)/archive/` — archive list page and thread detail
- `isArchived` boolean on Message model with DB index
- Sidebar nav already includes Archive link

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| List archive interaction | Both swipe + hover button | Swipe for mobile, hover button for desktop |
| Bulk selection model | Checkbox mode with floating action bar | Most explicit and discoverable; scales to future bulk actions |
| Keyboard navigation | vim-style (j/k nav, `e` to archive) | Full keyboard-driven flow in both list and detail views |
| Unarchive destination | User chooses (Imbox / Feed / Paper Trail) | Flexible — sender category may have changed since archiving |
| Build order | Incremental (unarchive → list archive → keyboard → bulk) | Each step independently useful and testable |

## Open Questions

- Should swipe direction matter? (e.g., swipe left = archive, swipe right = snooze/other future action)
- Should keyboard shortcuts be discoverable via a help overlay (e.g., `?` key)?
- Should the unarchive IMAP move go back to INBOX regardless of chosen category, or should Feed/Paper Trail map to different IMAP folders?
- Should bulk selection persist across page navigation, or reset when changing views?

## Scope

### In Scope
- Single and bulk archive/unarchive from list and detail views
- IMAP sync for both archive and unarchive operations
- Keyboard navigation with vim-style bindings
- Hover and swipe interactions on message list rows

### Out of Scope (for now)
- Other bulk actions (mark read/unread, move to Feed, etc.) — can be added later using the same bulk action bar
- Snooze / scheduled unarchive
- Archive from Feed or Paper Trail views (could be added later)
