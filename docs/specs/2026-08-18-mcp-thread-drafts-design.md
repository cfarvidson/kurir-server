# MCP thread drafts in the Drafts catalog - design

Date: 2026-08-18. Status: approved in dialog (architecture, catalog row,
open flow, MCP, tests).

Claude (via Kurir MCP) already persists reply drafts to the same `Draft`
rows as the PWA and iOS. Those rows appear in `/drafts`, but they are hard
to recognize and hard to reopen. This spec makes thread reply drafts
identifiable in the Drafts catalog and opens them on the thread, in the
right folder, with the composer showing the saved text.

Two repos: `kurir-server` (web, MCP, mobile API) and `kurir-ios` (iOS +
macOS).

## Goal

A reply drafted by Claude or by a human is findable in Drafts on every
client. The row shows who the thread is with and what it is about. Opening
it lands on that thread with the reply composer already open on the saved
text, whether the mail lives in Imbox, The Feed, Paper Trail, or Archive.

## Non-goals (this round)

- IMAP Drafts-folder sync
- Changing the Draft unique key or adding Prisma columns
- Sidebar count on Drafts
- A Draft badge on Imbox / The Feed / Paper Trail rows
- Opening FORWARD drafts on the thread (FORWARD stays on the compose page)
- A new `get_draft` MCP tool
- Switching the macOS sidebar away from Drafts when a reply is opened
- E2E tests against a live Claude client

## Locked decisions

- Approach: enrich at list time, pin the reply composer to the draft's
  `contextMessageId`. Do not change `(userId, type, contextMessageId)`.
- Pain this solves: catalog rows lack thread context (empty subject, no
  sender); opening a reply lands on the thread without the text (composer
  keyed to the last message, always `/imbox/{id}`).
- Open target: the thread, in the correct folder, composer open.
- Scope: web + MCP + iOS + macOS in one sweep.
- FORWARD stays on `/compose?forward=` / `ComposeView(.forward)`.
- Orphan reply (original message gone): detached compose, same as plan 037.
- No new MCP tools. `save_draft`, `get_thread`, and `list_mail` view
  `drafts` change contract. `send_mail` schema is unchanged.
- Filling an empty reply subject copies the original subject as-is. Do not
  prepend `Re:`.

## Architecture

The Draft row is already the source of truth. Three readers disagree about
context:

1. The catalog renders only `Draft` columns. The web reply composer saves
   `subject: ""`, so the row is "Reply · (no subject)".
2. Opening a reply always goes to `/imbox/{id}`. The composer loads
   `REPLY` + last incoming message, not the `contextMessageId` Claude
   saved against. The text looks gone.
3. MCP `save_draft` does not say to use a message `id` (and not
   `threadId`). `get_thread` does not return the draft.

```
save_draft / useDraft / DraftStore
        |
        v
   Draft row  (unchanged key)
        |
        +--> presentDraft() ----> /drafts, GET /api/mobile/drafts,
        |                         list_mail drafts
        |
        +--> findReplyDraftForThread(messageIds)
                 |
                 v
           pin on ThreadView / ReplyComposer
```

Shared server helpers live in `src/lib/mail/` (new focused module, not
more logic in `drafts.ts` page code):

- `presentDraft(draft, message | null)` - pure. Returns the three display
  fields. Used by web `/drafts`, mobile GET, and MCP list/save.
- `presentDraftsForUser(userId)` - loads drafts, batch-fetches context
  messages, maps `presentDraft`.
- `findReplyDraftForThread(userId, messageIds)` - `REPLY` drafts whose
  `contextMessageId` is in `messageIds`, newest `updatedAt` wins. `null`
  if none.

iOS/macOS mirror `findReplyDraftForThread` against GRDB `DraftStore` +
the thread's local message ids.

### Pin rule

When a thread opens, look up `REPLY` drafts for any message in that
thread.

- One draft: composer keys to that `contextMessageId` and opens with the
  body visible.
- Several: highest `updatedAt` wins.
- None: today's behavior (closed composer, last incoming message).

Reply headers (To, In-Reply-To, References) are computed from the
**pinned** message, not from the last incoming mail.

The same pin applies to every entry: Drafts, Imbox, The Feed, Paper Trail,
Archive. No query param. The thread page finds the draft itself.

## Catalog row

Same layout as today (type eyebrow, relative time, primary line, subject,
snippet). Content for `REPLY` comes from the presenter.

**NEW** (unchanged):

```
New                                 2h
To: ada@x.y
Q3 numbers
Draft body snippet…
```

**REPLY:**

```
Reply                               2h
Ada Lovelace
Q3 budget
Looks good, I'll send the numbers…
```

- Primary line = original from-name, else from-address. Not `To:`.
- Subject = `draft.subject` if non-empty after trim, else the original
  message subject. Never "(no subject)" when the original has a subject.
- Snippet = draft body, collapsed whitespace, 150 chars, as today.
- Orphan (no original): `To:` + "(no subject)" fallback, same as now.

**FORWARD** keeps `To:` + its own subject. No thread pin this round.

### Display fields

Added on list payloads. Not stored on `Draft`.

| Field | NEW | REPLY with original | Orphan REPLY |
| --- | --- | --- | --- |
| `displaySubject` | `draft.subject` or `""` | draft subject or original subject | `draft.subject` or `""` |
| `displayFrom` | `null` | `"Ada Lovelace"` or `"ada@x.y"` | `null` |
| `folder` | `null` | `imbox` \| `feed` \| `paper-trail` \| `archive` | `null` |

`folder` uses existing `getThreadRoute` flags (`isInImbox`, `isInFeed`,
`isInPaperTrail`, `isArchived`), mapped to the path segment without the
leading slash. Fallback when no flag is set: `imbox`.

Surfaces that must emit these fields:

- Web `getDrafts` / `/drafts`
- `GET /api/mobile/drafts`
- MCP `list_mail` view `drafts`
- MCP `save_draft` success payload

iOS `DraftListItem` grows the three fields. Online they come from the
API. Offline they are filled from the local `MessageRecord` when
`type != NEW` and that id exists. `DraftRow.subjectLine` uses
`displaySubject` when non-empty; the primary line uses `displayFrom`
when present, otherwise today's `To:` / "No recipient".

No sidebar count. No Draft badge in category lists.

## Open flow

### Web

Reply href is `/{folder}/{contextMessageId}` (`folder` from the
presenter). Orphan href stays
`/compose?draftType=REPLY&draft={id}&from=/drafts`.

`ThreadDetailView` calls `findReplyDraftForThread` with the thread's
message ids. If a draft is found, `ReplyComposer` receives that message
as `messageId` / reply headers / subject source, and opens (`hasDraft`
or the existing load-and-`setIsOpen` path). If not, last-incoming
headers stay as today.

`ReplyComposer` stops saving `subject: ""`. It saves the draft subject
already on the row, or the original message subject if that is empty.

NEW and FORWARD hrefs are unchanged.

### iOS

`DraftsListView.open` for `REPLY` with a local `MessageRecord` pushes
`ThreadView` (Files pattern: `navigationDestination`), not a
`ComposeView(.reply)` sheet. `ThreadView` applies the pin rule and opens
the reply dock / sheet on the pinned message.

NEW and orphan REPLY/FORWARD stay detached compose. Orphan delete-on-
dismiss is unchanged.

Back returns to Drafts.

### macOS

`DraftsListView` already owns a `NavigationStack` in `MailSplitView`.
A reply with a local message pushes `ThreadView` onto that stack instead
of replacing the list with `ComposeView`. The sidebar stays on Drafts.
Switching to Imbox/The Feed would recreate the stack and is out of scope.

Mac already auto-opens the inline reply dock when a draft exists for
`messages.last`. That check uses the pin helper (any message in the
thread, newest wins), not only the last message.

## MCP

No new tools.

### `save_draft`

Description must state:

- Reply: `type: "REPLY"` and `contextMessageId` = the message `id` from
  `get_thread` (the `id` field, not `threadId`).
- New mail: `type: "NEW"` and a client UUID, not `"__new__"`.
- The draft appears in the user's Drafts folder and on the thread. Do
  not write the email only in chat.

Validation: `REPLY` / `FORWARD` require `contextMessageId` to be a
message the user owns. Otherwise error exactly:

`contextMessageId must be a message id from get_thread, not a threadId`

If `subject` is missing/blank on a reply, copy the original subject.
If `emailConnectionId` is omitted on `REPLY` / `FORWARD`, inherit it
from the context message.

Success payload includes `id`, `type`, `contextMessageId`, plus
`displaySubject`, `displayFrom`, `folder`.

### `get_thread`

Adds `draft: { type, contextMessageId, to, cc, bcc, subject, body,
displaySubject, displayFrom, updatedAt } | null` using the same pin
rule (REPLY only). Claude can see and continue an in-progress reply.

### `list_mail` view `drafts`

Each item includes `displaySubject`, `displayFrom`, `folder` in addition
to today's fields.

### `send_mail`

Schema unchanged. Description notes that if the mail was saved with
`save_draft`, pass `draft: { type, contextMessageId }` so the row is
deleted after a successful send (already implemented in `sendMailForUser`).

## Write path (subject)

Today `reply-composer.tsx` autosaves `subject: ""`, which is why catalog
rows are anonymous even after the presenter exists. After this change:

- Web `ReplyComposer` persists the non-empty subject described above.
- MCP `save_draft` fills a blank reply subject from the original.
- iOS `ComposeView` already stores the compose subject; no change
  required unless a reply path is also writing an empty string (verify
  during implementation; do not empty a non-empty server subject).

Existing empty-subject rows become readable via `presentDraft` without
a backfill.

## Testing

TDD against behavior. No live Claude. Mocks only at the DB / store
boundary.

### Server (Vitest)

`presentDraft` / `findReplyDraftForThread` (pure or thin DB):

- Empty `draft.subject` + original subject `Q3 budget` =>
  `displaySubject === "Q3 budget"`, `displayFrom` from original.
- Non-empty `draft.subject` wins over the original.
- `folder` follows `getThreadRoute` for each category flag.
- Missing original => `displayFrom: null`, `folder: null`.
- Two REPLY drafts in one thread => newest `updatedAt` is pinned.
- No reply draft in the thread => `null`.

MCP handlers:

- `save_draft` REPLY with a `threadId` or unknown id => the exact error
  string above.
- `save_draft` REPLY against an owned message, no subject => subject
  filled, response has `displaySubject` and `folder`.
- `get_thread` includes `draft` when a reply exists on any message in
  the thread.
- `list_mail` view `drafts` includes the three display fields.

Web href helper (extracted from `getDrafts` if needed):

- Feed message => `/feed/{id}`.
- Orphan => `/compose?draftType=REPLY&draft=…`.

Reply composer save: does not send `subject: ""` when an original
subject exists.

### iOS / macOS (XCTest)

- `DraftRow` uses `displaySubject` / `displayFrom` when set, else the
  current fallback.
- `open` on REPLY with a local `MessageRecord` targets `ThreadView`,
  not `ComposeView(.reply)`.
- `open` on orphan after a sync has run stays detached compose.
- Pin helper matches the server rule against GRDB fixtures.

## Implementation order

1. Server presenter + pin helper, tests first.
2. Wire presenter into `/drafts`, mobile GET, MCP list/save/`get_thread`.
3. `save_draft` validation + subject/connection fill.
4. Web thread page pin + `ReplyComposer` subject save + folder href.
5. iOS/macOS list fields, `DraftsListView` navigation, `ThreadView` pin.

Parade releases (server then iOS) so old app versions still list drafts;
they just ignore unknown JSON keys.

## Out of scope leftovers (later)

- Draft count in the sidebar
- Draft marker on category list rows
- FORWARD opened on the thread
- macOS sidebar jump into Imbox/The Feed
- IMAP Drafts
