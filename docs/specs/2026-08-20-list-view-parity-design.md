# List view parity (web, iOS, macOS) - design

Date: 2026-08-20. Status: approved in dialog (Reply Later stack, New For You
sections, per-list filtered search, union of features, row contract, actions).

Kurir's mail lists already share filters, terracotta unread ticks, and (on
Mac) masthead copy plus hover actions. The rows, empty states, search scope,
select bar, and Reply Later still disagree between the PWA, iOS, and macOS.
This spec is the shared contract.

Two repos: `kurir-server` (web + `GET /api/mobile/search`) and `kurir-ios`
(iOS + macOS).

## Goal

A person who uses Kurir on the phone, on the Mac, and in the browser sees
the same list: same row, same actions for that mailbox, same search, same
empty copy. Platform idioms stay (iOS navigation title and edit-mode,
Mac hover, web `/` search). Everything that already exists on one client
exists on the others.

## Non-goals (this round)

- Redesigning the Screener card (pending / skipped / screened already match
  in structure; copy and chrome only if they violate DESIGN.md)
- Avatars, pill badges, or a second accent
- IMAP-side list changes
- A shared TypeScript/Swift package
- Changing thread collapse rules (`collapseToThreads` / `MailStore`)
- Command palette search (Mac) as a replacement for per-list search
- Infinite scroll windowing on iOS (Mac keeps the 200-row window for Archive)

## Locked decisions

- Reply Later is a focus stack on every client. It is not a `MessageRow` list.
- Imbox, The Feed, and Paper Trail section into **New For You** (unread) and
  **Previously Seen** (read), sticky eyebrow, on web, iOS, and macOS.
- Search is per-list and filtered to that list. Same seven lists as today's
  web `SearchInput`. Reply Later has no search.
- Union: a feature that exists on one client is added to the others. Native
  Block-in-select-bar and Read-in-select-bar come to web. Native two-line
  snippet comes to web and Mac. Web row chrome (`·N`, paperclip, snooze
  time) comes to native.
- Allowlist of platform idioms: iOS `navigationTitle` + system Search (not
  a Mac masthead on the phone), iOS edit-mode checkmarks, Mac hover chips,
  Mac 200-row window, iOS calendar dates vs web/Mac relative dates.
- Web is the source of empty-state title + description strings.
- Sent hover/swipe does not archive or snooze. Native's current snooze swipe
  on Sent goes away.
- Implementation: TDD against pure contract helpers first, then UI.
- Two implementation plans after this spec: one for `kurir-server`, one for
  `kurir-ios`. They share this document. Server search `category` ships
  before native starts sending it.

## Architecture

The contract is data, not a shared UI kit.

```
list id  -->  RowActionSet / ListSearchScope / EmptyCopy / sections?
                |
                +--> web: InfiniteMessageList + MessageRow
                +--> native: MessageListView + MessageRow
                +--> Reply Later: ReplyLaterFocus (web + native)
```

`kurir-ios` already has `RowActionSet` and `MastheadInfo` as testable
maps. This spec adds the missing maps (row chrome, search scope, empty
copy, sections, select-bar, Reply Later) in both repos as pure functions
the views call.

`GET /api/mobile/search` today always passes an empty category filter, so
native search is global even when the Mac masthead sits on Feed. The
server grows an optional `category` query param. Native sends it.

## Mail lists in scope

| List | Web route | Native `MailList` | Sections | Search |
|------|-----------|-------------------|----------|--------|
| Imbox | `/imbox` | `.imbox` | yes | yes |
| The Feed | `/feed` | `.feed` | yes | yes |
| Paper Trail | `/paper-trail` | `.paperTrail` | yes | yes |
| Snoozed | `/snoozed` | `.snoozed` | no | yes |
| Follow Up | `/follow-up` | `.followUp` | no | yes |
| Sent | `/sent` | `.sent` | no | yes |
| Archive | `/archive` | `.archive` | no | yes |
| Reply Later | `/reply-later` | `.replyLater` | n/a (stack) | no |

Sidebar / tab labels stay as they are. Masthead title for Follow Up is
`Follow Up` (no hyphen) on every client, matching web. Native
`MailList.followUp.rawValue` may stay `Follow-up` for the More-tab label
if that string is already shipped; the masthead and empty title use
`Follow Up`.

## Row contract

Applies to every mail list except Reply Later. One shared `MessageRow`.

Order, left to right then down:

1. Unread tick: 3px terracotta left rule, ~60% of row height, no layout
   shift, no row fill. Hidden when read or when the row is in select mode.
2. Select checkbox: only in select mode (web and Mac custom; iOS native
   edit-mode).
3. Sender: `displayName || fromName || fromAddress`. Sent lists show
   `To: ` plus the joined `toAddresses` (or `Cc:` / `Bcc only` if To is
   empty, matching Scheduled). Semibold when unread, medium when read.
4. Thread count: `·N` in mono tabular-nums when `threadCount > 1`. Not a
   pill. Not a bare integer.
5. Paperclip when `hasAttachments`.
6. Date, right-aligned, tabular-nums, muted. Web and Mac:
   `formatDistanceToNow` / `RelativeDate`. iOS: time today, `d MMM` this
   year, `d MMM y` older (`MessageRow.dateString` stays).
7. Subject, one line. `(no subject)` when empty. Unread: heavier and
   foreground. Read: muted. Web unread subject is `text-lead`; Mac unread
   subject is 17pt medium, read 15pt. iOS keeps Dynamic Type but unread
   is semibold.
8. Snippet, two lines if present, muted, smaller than subject. Empty
   snippet omits the line.
9. Extra meta, one line under the snippet:
   - Snoozed list: alarm icon + `formatSnoozeUntil(snoozedUntil)`
   - Any list: follow-up icon + time when `followUpAt` is set (today the
     web only tints the hover bell; the row itself should show the time
     on Follow Up and whenever a follow-up is armed)

No avatars. No category color on the mail row. Hairline separator.
Padding: iOS 10/16, desktop/Mac 12/24 (`md:px-6 md:py-4`). Hover wash is
`muted/50` (web) / 5% primary (Mac), selected wash is `primary/10`.
Keyboard focus is a terracotta inset ring.

Drafts, Files, Contacts, Screener, and Scheduled keep their own row
types but use the same padding, hairline, and empty-state primitive.

## Actions

### Hover (web `md+`, Mac)

Words first, then icon, then kbd. Order: Follow up, Snooze, Archive (or
Unarchive). Hidden on touch. Hidden in select mode.

| List | Follow up | Snooze | Archive | Unarchive |
|------|-----------|--------|---------|-----------|
| Imbox, Feed, Paper Trail, Snoozed | yes | yes | yes | no |
| Follow Up | yes | no | yes | no |
| Sent | yes | no | no | no |
| Archive | yes | no | no | yes |
| Reply Later | no | no | no | no |

Follow-up trigger tints when `followUpAt` is set.

### Swipe (web touch + iOS)

- Leading: Read if unread, Unread if read. Blue.
- Trailing, full-swipe: Archive (terracotta) or Unarchive on Archive.
- Trailing, second button:
  - Snoozed: Unsnooze
  - Follow Up: Dismiss
  - Imbox, Feed, Paper Trail, Archive: Snooze (web default remains
    tomorrow 08:00; iOS keeps the preset sheet)
  - Sent: none
- Reply Later has no swipe. It is not a list.

Mac has no swipe. Hover + keyboard cover the same verbs.

### Keyboard (web + Mac)

Already present, keep and extend:

- `j` / `k` / arrows: move focus
- `Enter` / `o`: open
- `e`: archive or unarchive for the current list
- `s`: snooze if the list allows it
- `f`: follow up if the list allows it
- `x`: toggle select
- `Shift+U`: toggle read
- `/`: focus search (lists that show search)
- `Escape`: clear select, or close the open thread on Mac

Block sender stays on the thread and on the select bar, not a single-key
list shortcut (native already posts `kurirBlockSender` from an open
thread). Do not add a new list key for Block.

### Select bar (web, iOS, Mac)

Visible when at least one conversation is selected.

- Count: `N conversation(s) selected`, tabular-nums
- Snooze, only if `RowActionSet.snooze` is true for the list
- Archive or Unarchive (Archive list unarchives)
- Read / Unread (iOS already; web and Mac add it). Label follows the
  selection: Read if any selected row is unread, else Unread
- Block sender (native already; web adds it). Unique non-own senders in
  the selection. Confirm at 10+ messages from one sender, or 2+ senders,
  matching the 2026-08-19 block-sender spec
- Cancel / X

Web today has no Block and no Read on the bar. Mac has Block but no Read.
iOS always shows Snooze even on Archive and Follow Up; that stops. iOS
keeps the bottom system-bar layout; web and Mac keep the floating pill.

Undo: archive / unarchive / snooze raise one undo toast. Read does not
(prior per-thread read state is not uniform). Block in the select bar
follows the 2026-08-19 block-sender spec on every client (confirm
thresholds, undo inverse, stay-in-thread when opened from Archive).

## Search

Seven lists show search. Reply Later does not.

- Query length >= 2 after trim
- Hits are restricted to the open list's filter (same predicates as
  `CATEGORY_FILTERS` / `MailStore.filter`, plus Sent = sent folder)
- Contact hits render first when any match, under an eyebrow `Contacts`,
  then messages under `Messages` if both groups are present
- Message hits use the full `MessageRow` for that list (actions, tick,
  paperclip). They are not a preview stub with `messageCount: 1` and no
  swipe. Search stays per-message (a finder, not a second mailbox), so
  `·N` is omitted unless the hit is collapsed. Do not collapse search
  hits. Enrich each hit with `hasAttachments`, `snoozedUntil`,
  `followUpAt`, and sender display so the row chrome other than `·N`
  still renders.
- Empty: title `No results found`, description
  `No messages or contacts match “{query}”`
- Opening a hit marks it read the same way opening a list row does

### Server

`GET /api/mobile/search` accepts optional `category`:

`imbox | feed | paper-trail | archive | snoozed | follow-up | sent`

Omitted `category` keeps today's unfiltered search (back-compat). Unknown
values: 400. The SQL fragment is the same one the web `SearchResults`
pages already pass.

Native `APIClient.search` sends `category` from the open `MailList`.

Web `SearchResults` already filters. Gaps to close on web:

- Pass `showFollowUpAction` on Imbox, Feed, Paper Trail, Snoozed, Follow
  Up, Sent, Archive search
- Pass `showUnarchiveAction` on Archive search
- Pass `showArchiveAction` / `showSnoozeAction` as the list already does
- Search hits stay per-message. Enrich the web `MessageSearchResult` (and
  the mobile re-fetch, which already uses `MESSAGE_SELECT`) with snooze /
  follow-up / sender fields the row needs.

## Sections

Imbox, Feed, Paper Trail only.

- `New For You`: unread threads, newest first
- `Previously Seen`: read threads, newest first
- Sticky eyebrow, `text-eyebrow`, muted
- Opening a thread moves it to Previously Seen after navigation (web
  already delays the cache write ~300ms so the row does not jump under
  the finger). Native mirrors that: do not regroup until the list is
  visible again
- Empty section is omitted (no "New For You" header over zero rows)
- Select, keyboard focus, and infinite scroll work across both sections
  as one sequence (j/k walks New then Seen)

Snoozed, Follow Up, Sent, Archive stay a single chronological list.
Snoozed sort remains wake order (`snoozedUntil` asc).

## Reply Later

A dedicated focus view on every client. Not `MessageListView`.

- Masthead: eyebrow `Later`, title `Reply Later`
- Progress: `N of M to reply`
- Card: sender, subject, snippet (up to four lines), date, `N messages
  in thread` when count > 1
- Primary: `Open & reply` -> thread in the folder `getThreadRoute`
  would pick, composer open
- `Done`: clear the reply-later flag, advance to the item that shifts
  into this slot
- Previous / next: skip without clearing
- Empty: `All caught up` / `Nothing left to reply to. Nice work.`
- Pull to refresh on native. Web relies on the existing sync
- No search, no select, no hover, no swipe, no `MessageRow`

iOS: replace the More-tab `MessageListView(list: .replyLater)` with
`ReplyLaterFocusView`. Mac: same in the sidebar pane, masthead owned by
the focus view.

## Empty copy

Web strings win. Drop native's generic quiet line
(`Nothing here - enjoy the quiet.`).

| List | Title | Description |
|------|-------|-------------|
| Imbox | Your Imbox is empty | Approve senders in the Screener to see their emails here. |
| Feed | No newsletters yet | Screen in newsletter senders and send them to The Feed. |
| Paper Trail | No receipts yet | Screen in transactional senders and send them to Paper Trail. |
| Snoozed | No snoozed conversations | Snoozed conversations will appear here until they wake up. |
| Follow Up | No follow-ups | Threads you're waiting on will appear here when the deadline passes. |
| Archive | Archive is empty | Archived conversations will appear here. |
| Sent | No sent messages | Messages you send will appear here. |
| Reply Later | All caught up | Nothing left to reply to. Nice work. |
| Drafts | No drafts | Mail you start writing shows up here. |
| Scheduled | No scheduled messages | Messages you schedule to send later will appear here. |
| Files | No files | Attachments from your mail will appear here. |
| Contacts | No contacts | Add a contact with New. (iOS: "Add a contact with the + button.") |

First-sync empty (native, store not yet filled) stays the spinner plus
`Syncing your mail…`. That is not an empty mailbox.

Empty UI primitive: web `EmptyState` (quiet icon, optional eyebrow,
Playfair title). Mac `MacEmptyState` already mirrors it. iOS
`ContentUnavailableView` is allowed (system search empty, Dynamic Type)
but must use the titles and descriptions above, not the generic quiet
line.

## Other lists

### Sent (web)

Move from `MessageList` to `InfiniteMessageList` so Sent gains infinite
load, select, keyboard, and the select bar. Add `sent` to
`CATEGORY_FILTERS` / `GET /api/messages?category=sent` using the same
sent-folder predicate the page uses today (`folder.specialUse = sent`,
not category flags). Native already filters on `folderRole == sent`.

### Drafts

Already close. Keep type eyebrow, recipient/from line, subject, snippet,
relative `updatedAt`, confirm on the visible Delete. Snippet two lines
on iOS, two lines on web/Mac after this spec (union). Mac padding 12/24.

### Files

- Infinite load on web (sentinel), matching native `onAppear` paging.
  Remove the `Load more` button.
- `Open message` uses `getThreadRoute(message)` + id, never a hardcoded
  `/imbox/{id}`.
- Row: type icon, filename, `From {name} · {subject}`, size, date.

### Contacts

Union: A–Ö sections and category filters (All / Imbox / Feed / Paper
Trail / Uncategorized) on web and native. Filter chips stay quiet
(underline or text, not filled pills). Native empty copy as in the
table. Groups link stays in the masthead / toolbar.

### Scheduled

Row shows recipient, subject, snippet, scheduled time, Failed/Pending.
Actions: Edit, Send now, Cancel on every client (web already; native
adds Edit and shows snippet). Mac padding 12/24.

## Testing

Pure helpers first. No UI snapshot requirement in CI.

Web (`src/__tests__/unit/`):

- `list-row-chrome`: `·N` only when count > 1, paperclip flag, snooze
  meta only when shown, sender vs To: line
- `list-action-set`: same matrix as `RowActionSetTests`
- `list-search-scope`: category -> SQL/filter mapping, unknown category
- `empty-copy`: title/description per list
- `GET /api/mobile/search`: omitted category stays unfiltered; known
  category applies the list predicate; unknown -> 400
- Select bar: snooze hidden on Follow Up and Archive; Block and Read
  present
- Reply Later focus: Done advances, last item empty-state, skip does not
  clear (extend `reply-later-focus.test.tsx`)

Native (`Kurir/Tests/`):

- Extend `RowActionSetTests` (Sent has no snooze, including swipe)
- `MessageRow` chrome: `·N`, paperclip, snooze meta, two-line snippet
- `MailList` sections: unread then read, empty section omitted
- Search: `category` query item; iOS search enabled on the seven lists
- `ReplyLaterFocus` presentation: queue, Done, skip
- `MastheadInfo` / empty copy strings match the table
- Follow Up masthead title `Follow Up`

Watch each test fail before implementing.

## Files likely to change

**kurir-server**

- `src/components/mail/message-list.tsx` (chrome, two-line snippet,
  follow-up meta, leading swipe read)
- `src/components/mail/infinite-message-list.tsx` (Sent category)
- `src/components/mail/search-results.tsx` (action flags)
- `src/components/mail/selection-action-bar.tsx` (Read, Block, snooze
  gated)
- `src/components/mail/swipeable-row.tsx` (leading Read / Unread)
- `src/app/(mail)/sent/page.tsx` (infinite + select)
- `src/app/api/mobile/search/route.ts` + `src/app/api/messages/route.ts`
- `src/lib/mail/messages.ts` if Sent becomes a category
- `src/components/mail/files-list.tsx` (infinite, `getThreadRoute`)
- `src/components/contacts/contact-list.tsx` (A–Ö union)
- `src/components/mail/reply-later-focus.tsx` (already the model)

**kurir-ios**

- `MessageListView.swift` / `MessageRow` (sections, chrome, iOS search,
  empty copy, swipe on Sent)
- `RowActionSet.swift` (already correct; wire swipe to it)
- `MacSelectionBar.swift` + iOS `bulkBar` (snooze gated, add Read on Mac)
- `DraftsListView.swift`, `FilesView.swift`, `ContactsView.swift`,
  `ScheduledListView.swift`
- New `ReplyLaterFocusView.swift`
- `APIClient.search` category param
- `MastheadInfo` / empty strings

## Out of this spec's UI taste

DESIGN.md still applies: terracotta accent, no avatars, no resting
shadow, Playfair on mastheads and empty titles, Inter on rows, counts
in `tabular-nums`, categories as quiet signifiers only on Screener /
Contacts, not on mail rows.
