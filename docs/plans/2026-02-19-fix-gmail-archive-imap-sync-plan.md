---
title: "fix: Gmail archive sync — IMAP move never fires"
type: fix
date: 2026-02-19
---

# fix: Gmail archive sync — IMAP move never fires

## Overview

Archiving in Kurir updates the DB but never moves the message on Gmail's IMAP server. The message stays in Gmail's INBOX.

## Problem

`archiveConversation()` looks for a mailbox with IMAP flag `\Archive` or path `archive`. Gmail has neither — Gmail's "archive" means removing the INBOX label, leaving the message in `[Gmail]/All Mail` (IMAP flag `\All`).

Same issue in reverse: `unarchiveConversation()` queries the DB for `specialUse: "archive"`, but sync stores Gmail's All Mail as `specialUse: "all"`.

**Root cause table:**

| Action         | Looks for                    | Gmail has | Result                                 |
| -------------- | ---------------------------- | --------- | -------------------------------------- |
| Archive (IMAP) | `specialUse === "\\Archive"` | `"\\All"` | `archiveBox = undefined`, move skipped |
| Unarchive (DB) | `specialUse: "archive"`      | `"all"`   | `archiveFolder = null`, move skipped   |

## Fix

Extend both lookups to fall back to `\All` when `\Archive` isn't found. Standard IMAP servers with a real `\Archive` folder are unaffected — `\Archive` is still preferred.

### 1. `src/actions/archive.ts` — `archiveConversation()` (~line 56)

**Before:**

```typescript
const archiveBox = mailboxes.find(
  (mb) => mb.specialUse === "\\Archive" || mb.path.toLowerCase() === "archive",
);
```

**After:**

```typescript
const archiveBox =
  mailboxes.find(
    (mb) =>
      mb.specialUse === "\\Archive" || mb.path.toLowerCase() === "archive",
  ) ?? mailboxes.find((mb) => mb.specialUse === "\\All");
```

### 2. `src/actions/archive.ts` — `unarchiveConversation()` (~line 140)

**Before:**

```typescript
const archiveFolder = await db.folder.findFirst({
  where: { userId, specialUse: "archive" },
  select: { id: true },
});
```

**After:**

```typescript
const archiveFolder = await db.folder.findFirst({
  where: { userId, specialUse: { in: ["archive", "all"] } },
  select: { id: true },
});
```

### 3. `src/actions/archive.ts` — `unarchiveConversation()` (~line 163)

The IMAP mailbox lookup for unarchive has the same problem — it needs to find `\All` too:

**Before:**

```typescript
const archiveBox = mailboxes.find(
  (mb) => mb.specialUse === "\\Archive" || mb.path.toLowerCase() === "archive",
);
```

**After:**

```typescript
const archiveBox =
  mailboxes.find(
    (mb) =>
      mb.specialUse === "\\Archive" || mb.path.toLowerCase() === "archive",
  ) ?? mailboxes.find((mb) => mb.specialUse === "\\All");
```

## Acceptance Criteria

- [ ] Archiving a message in Kurir removes it from Gmail INBOX
- [ ] Unarchiving a message in Kurir moves it back to Gmail INBOX
- [ ] Echo suppression still works (no re-processing from IDLE)
- [ ] Non-Gmail IMAP servers with `\Archive` are unaffected

## Context

- Brainstorm: `docs/brainstorms/2026-02-19-gmail-archive-sync-brainstorm.md`
- `mapSpecialUse()` in [sync-service.ts:74-89](src/lib/mail/sync-service.ts#L74-L89) maps `\All` → `"all"` and `\Archive` → `"archive"`
- Echo suppression in [flag-push.ts:6-17](src/lib/mail/flag-push.ts#L6-L17) — already called before IMAP moves
- All Mail dedup in [sync-service.ts:217-224](src/lib/mail/sync-service.ts#L217-L224) prevents duplicate records after move
