# Settings backup (takeout) - design

Date: 2026-08-17. Status: approved in dialog (payload, storage, schedule, restore, failures).

A user-facing settings takeout so a wipe or reinstall of Kurir can restore
contacts, screening, and mail preferences from the same IMAP mailbox.

This is not the operator backup in `docs/BACKUP.md` (Postgres, Redis, env).

## Goal

After a complete fresh install, the user reconnects the same mailbox. Dummy
Sent emails come back on the first sync. Setup lists those backups. The user
picks one. Contacts, groups, sender screening, domain rules, per-sender flags,
and mail preferences come back. Mail itself is not in the file.

## Non-goals (v1)

- Backing up messages, bodies, snippets, flags, snooze, follow-up, reply-later
- Drafts, scheduled mail, or real (non-backup) attachments
- IMAP credentials, passkeys, sessions, push tokens, MCP tokens
- Download-to-disk / file upload during setup
- Encrypting the JSON beyond "it lives in the user's mailbox"
- SMTP send-to-self
- iOS or macOS setup UI (after a web restore, mobile sync picks up the data)
- Operator/infra backup changes
- A second source of truth besides the dummy Sent message

## Locked decisions

- Approach: dummy Sent mail is the store. One versioned JSON attachment.
- Dummy means no SMTP. Local Sent row plus IMAP APPEND, same helpers as a
  normal send (`createLocalSentMessage` + `appendToImapSent`).
- Survive wipe: same mailbox, new Kurir. Restore reads the synced Sent copy.
- Setup: after first sync, list every dummy backup in Sent, user picks or skips.
- Settings: Backup now, off / daily / weekly, and restore from the same list
  anytime.
- Retention: keep the 4 newest dummy backups in that mailbox (manual and
  scheduled share the cap). Delete older copies locally and on IMAP.
- Hard rule: the JSON must not contain email messages.
- Identity in the file is addresses, never Kurir ids.
- Cadence is a field on `User`, not a `ScheduledMessage`.
- "Backup now" writes immediately and does not move `settingsBackupNextRunAt`.

## Payload

One JSON file named `kurir-settings-YYYY-MM-DD.json` (date in the user's
timezone, calendar day of the write).

```json
{
  "kind": "kurir-settings-backup",
  "version": 1,
  "exportedAt": "2026-08-17T01:00:00.000Z",
  "source": "manual",
  "preferences": {
    "theme": "system",
    "timezone": "Europe/Stockholm",
    "blockRemoteImages": true,
    "blockTrackers": true,
    "showImboxBadge": true,
    "showScreenerBadge": true,
    "showFeedBadge": true,
    "showPaperTrailBadge": true,
    "showFollowUpBadge": true,
    "showReplyLaterBadge": true,
    "showScheduledBadge": true
  },
  "contacts": [
    {
      "name": "Ada",
      "notes": "",
      "emails": [
        { "email": "ada@example.com", "label": "work", "isPrimary": true }
      ]
    }
  ],
  "contactGroups": [
    {
      "name": "Family",
      "defaultTarget": "TO",
      "members": ["ada@example.com"]
    }
  ],
  "senders": [
    {
      "connectionEmail": "you@gmail.com",
      "email": "news@github.com",
      "domain": "github.com",
      "status": "APPROVED",
      "category": "FEED",
      "unthread": false,
      "allowRemoteImages": false
    }
  ],
  "domainRules": [
    {
      "connectionEmail": "you@gmail.com",
      "pattern": "github.com",
      "includeSubdomains": true,
      "status": "APPROVED",
      "category": "FEED"
    }
  ]
}
```

`source` is `"manual"` or `"scheduled"`. It is display-only (setup/Settings
list). It does not change apply.

### Included

- Mail preferences listed above. Not `displayName`, not role.
- Contacts: name, notes, emails (address, label, primary).
- Contact groups: name, defaultTarget, member email addresses.
- Decided senders only (`APPROVED` or `REJECTED`). Never `PENDING`.
- Per-sender `unthread` and `allowRemoteImages`.
- Domain rules: pattern, includeSubdomains, status, category.

Senders and domain rules are keyed by `connectionEmail` (the mailbox they
belong to) plus the sender/rule identity. `decidedByRuleId` is not exported.

### Excluded

- Any message field (id, subject, body, snippet, flags, folder, thread).
- Pending senders. They reappear from sync.
- Credentials, secrets, tokens, passkeys.
- Connection config (IMAP/SMTP hosts, aliases, treatDomainAsOwn). Reconnect
  during setup owns that.

Parse rejects unknown `kind`, `version !== 1`, or a payload that contains
any of these top-level keys: `messages`, `threads`, `drafts`, `folders`.
Restore does not begin until parse succeeds.

## Storage

### Dummy Sent email

| Field | Value |
|---|---|
| From | The connection's send-as / email |
| To | The same address |
| Subject | `Kurir settings backup - 17 Aug 2026` |
| Body | Short plain-text note: this is a settings snapshot, not a letter |
| Attachment | The JSON file above |
| SMTP | Not called |

Subject prefix is ASCII: `Kurir settings backup - `. The date is the user's
local calendar day. Detector after sync:

1. Subject starts with `Kurir settings backup -`
2. At least one attachment filename matches `^kurir-settings-.*\.json$`

Do not depend on custom headers. `Message` does not store them.

### Where it lives

The dummy email is written to the default connection's Sent folder
(`EmailConnection.isDefault`, else the oldest connection). The JSON still
describes every connection the user has (keyed by address). After a fresh
install, only slices whose mailbox is connected again are applied.

### Write path

Manual "Backup now" and the scheduled job share one function:

1. Snapshot current settings into the JSON (latest state at write time).
2. Create the attachment row and the local Sent message
   (`createLocalSentMessage`).
3. IMAP APPEND (`appendToImapSent`).
4. Prune: among dummy backups in that mailbox, keep the 4 newest by
   `sentAt`. Delete older ones on IMAP first, then locally. If IMAP delete
   fails, keep the local row so we still know it exists.

A write with no email connection or no Sent folder is a hard failure.

Scheduled success (advance `settingsBackupNextRunAt`) requires the local
row **and** a successful APPEND. An APPEND failure keeps the local row,
warns that it will not survive a wipe, and leaves `nextRunAt` alone so the
next tick writes a fresh snapshot that can land in IMAP.

Manual "Backup now" still keeps the local row on APPEND failure and shows
the same warning. It never touches `nextRunAt`.

## Schedule

New fields on `User`:

- `settingsBackupCadence` — `"off"` (default) \| `"daily"` \| `"weekly"`
- `settingsBackupNextRunAt` — `DateTime?`, null when off

Not a `ScheduledMessage`. Recurring snapshot is a job, not a letter.

New maintenance task (same BullMQ worker as snooze / scheduled-send), e.g.
`settings-backup`. Each tick: users with `settingsBackupNextRunAt <= now()`,
write one snapshot per user, on success set next run. On failure leave the
timestamp and retry next tick. Isolate per-user errors.

### Next-run rules

All wall times are 03:00 in `user.timezone`.

- Turn **daily** on: next 03:00 (today if still ahead, else tomorrow).
- Turn **weekly** on: next 03:00 on this weekday (today if still ahead).
- Change cadence: recompute from now with the new rule.
- Turn **off**: set cadence `off`, `settingsBackupNextRunAt = null`.
- After a successful scheduled write: add 1 day (daily) or 7 days (weekly)
  to the just-fired local 03:00, so a slow job does not drift.
- **Backup now** does not change `settingsBackupNextRunAt`.

## Restore

Same apply function for setup and Settings.

### Setup

After the first-sync step, before "You're all set":

- List dummy backups found in Sent: `sentAt`, `source` if the attachment
  parses, filename.
- User picks one or skips.
- Skip goes to done with a clean Screener.

### Settings

Mail tab, Backup section:

- Backup now
- Cadence: Off / Daily / Weekly, plus a next-run hint
- The same Sent backup list, with Restore

### Apply order (one transaction)

1. Parse and version-check. Fail closed on invalid JSON, wrong kind/version,
   or mail-shaped keys. Nothing is written.
2. Write `preferences` onto the user.
3. Upsert contacts by email address (any of the contact's addresses). Create
   if none match. Merge emails onto the matched contact. Groups match by
   name (first match if names collide); members are the backup's email list.
4. Upsert domain rules on each **connected** mailbox, match
   `(connectionEmail, pattern, includeSubdomains)`. Then run the existing
   retroactive PENDING sweep for those rules.
5. For each backed-up sender on a connected mailbox:
   - If a Sender with that email exists on that connection, set status,
     category, unthread, allowRemoteImages.
   - If not, create the Sender (domain from the file, `messageCount` 0) so
     future mail is already decided.
6. Recategorize already-synced messages with the existing
   `approveSenderForUser` / `rejectSenderForUser` cores so Screener mail
   moves to Imbox, Feed, Paper Trail, or out of the way.

Explicit sender rows win over domain rules because they run after the rule
sweep.

Pending live senders that are not in the backup stay pending, unless a
restored domain rule matches them in step 4.

### Connection slices

A `connectionEmail` that is not a connected account is skipped and reported
("no account for old@job.com"). That is not a hard error. Nothing is applied
by Kurir id.

Attachment body may still be IMAP-lazy. Restore fetches content if the
`Attachment.content` column is empty, then parses.

## Failures

| Case | Behavior |
|---|---|
| Invalid / unknown version / mail-shaped JSON | Whole restore fails. No writes. |
| Missing attachment content and IMAP fetch fails | Whole restore fails. |
| IMAP APPEND fails after local write | Local Sent row stays. Warn that it will not survive a wipe. Scheduled run does **not** advance `nextRunAt`. |
| No connection / no Sent folder on write | Hard fail. Do not advance `nextRunAt`. |
| IMAP delete fails during prune | Keep the local row. Do not silently drop tracking. |
| One user's scheduled write throws | Log, continue other users. |

## Tests

Unit tests, no live IMAP. Mock persist-sent / IMAP helpers.

- Serialize → parse round-trip of a full v1 payload.
- Parse rejects unknown version, wrong kind, and a `messages` key.
- Restore matches senders/rules by address, creates missing senders, upserts
  contacts/groups/rules, writes preferences.
- Restore recategorizes already-synced Screener mail for an approved sender.
- Restore skips a disconnected mailbox slice and still applies the rest.
- Detector accepts the subject prefix + filename; ignores ordinary Sent mail.
- Retention keeps the 4 newest by `sentAt` and requests delete of the rest.
- Cadence: next run is 03:00 local; weekly keeps weekday; off clears
  timestamp; Backup now does not move next run.
- Failed write does not advance `nextRunAt`.

## File layout (implementation hint)

```
src/lib/mail/settings-backup.ts     # snapshot, parse, detect, apply, write, prune
src/actions/settings-backup.ts      # backup now, set cadence, list, restore
src/lib/jobs/maintenance-worker.ts  # new task settings-backup
src/components/settings/           # Backup section on Mail tab
src/components/auth/setup-wizard.tsx  # post-sync picker step
prisma/schema.prisma               # User.settingsBackupCadence, NextRunAt
prisma/migrations/0014_settings_backup.sql
```

Reuse `createLocalSentMessage` and `appendToImapSent`. Reuse
`approveSenderForUser` / `rejectSenderForUser` / domain-rule retroactive
sweep. Do not invent a parallel screening path.
