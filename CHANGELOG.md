# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MICRO`); entries predating the format flip use the older `YYYY.MM.N` and `YYYY.MM.DD` formats.

## [Unreleased]

## [v2026.66] - 2026-09-04

### Added

- On-demand IMAP check: `POST /api/mail/check` (cookie) and
  `POST /api/mobile/check` (bearer) run the cheap IDLE lastUid ingest
  instead of a full mailbox sync (#161)
- Web Sync on tab focus, first paint, Cmd+R / Ctrl+R, pull-to-refresh,
  the sidebar dot, the command palette, and Retry (#162)

## [v2026.64] - 2026-09-04

### Added

- Admin → Apps registers MCP OAuth clients for hosts that cannot publish
  a Client ID Metadata Document: name plus exact redirect URIs, an opaque
  `kmc_` client_id, per-client connection count, and delete that revokes
  the client's tokens. Public clients with mandatory PKCE, no secret.
  The CIMD path is unchanged (#157)

## [v2026.63] - 2026-09-03

### Changed

- Bump managed dependencies for the app and docs site (Next 16.3.4,
  React 19.2.8, Prisma 7.10, ioredis 6, SimpleWebAuthn 14, motion 13).
  Updater Alpine image 3.20 to 3.24 (#156)

## [v2026.58] - 2026-09-01

### Added

- Person pane lists links exchanged and appointments with the focused
  person, plus Email and Schedule time. Schedule time opens compose
  with free slots for the next seven weekdays and does not create a
  calendar event (kurir-ios#125)
- Stats lead with how long they take to reply and when they usually
  write; the histogram is labelled When they write
- Search gains an Appointments group between Messages and Files

## [v2026.56] - 2026-08-31

### Fixed

- Paired with iOS: Send after Generate draft closes the composer and
  drops the draft (kurir-ios#121)

## [v2026.55] - 2026-08-31

### Added

- The person pane is a persistent right column on wide windows that
  follows the focused message in every list and in search; with a thread
  open it shows the counterpart and folds the old contact column in. A
  search field inside the pane filters that person's conversations across
  all lists, including Archive (#115)
- Person profile built from the mail itself: phone numbers, title, and
  company lifted from signatures (a Contact record's own values win),
  sent/received counts, first and last contact, median response time in
  both directions, a time-of-day histogram, and Rank, a recency-weighted
  volume score with the person's position among everyone you mail (#116)
- Rank everywhere: Related senders becomes Network, sorted by strength
  with the number of shared threads; People in search are ordered by Rank
  and appear on the first typed character; search gains a Files group;
  compose suggestions draw from every address ever seen in From/To/Cc/Bcc,
  ordered by Rank, with domain and company typeahead (#117)

### Changed

- Rank is materialised per user in a `PersonRank` table, recomputed after
  each completed sync (`pnpm recompute-rank` runs it on demand); signature
  details are extracted during sync and backfilled once for existing mail
  (`pnpm backfill-signatures`)

## [v2026.54] - 2026-08-31

### Fixed

- The sidebar header, Compose row, and footer no longer compress in a
  short window; the nav scrolls instead of crushing the chrome around the
  courier mark (#101)

## [v2026.53] - 2026-08-30

### Added

- Search covers all mail from every list by default, with an
  All mail / this-list chip; hits show which list they live in (#102)
- People appear first in search results, matching on name, email, and
  domain, with an all-history person view including Archive (#103)
- Search filter chips for From, domain, attachment, date, and list (#105)

### Fixed

- The sidebar courier mark keeps its square shape and reads at small
  size (#101)
- New-mail Generate draft writes a new mail to the correspondent, not a
  reply to a latest mail that does not exist (#146). An empty instruction
  still infers from earlier correspondence with that person; with none,
  the composer is told to say what the mail should say instead of inventing
  one.

### Changed

- Generated mail is steered away from AI tells (puffery, em dashes,
  chatbot leftovers, filler) in the locked system prompt. Auto tone still
  matches the user's own sent mail.

## [v2026.51] - 2026-08-28

### Added

- Dedicated courier poses for Snoozed and Follow-up empty states (#144).
  Snoozed sleeps with an envelope and a crescent moon. Follow-up shades
  his eyes waiting for a reply. Cream-halo dark variants match the other
  list cutouts.

## [v2026.50] - 2026-08-28

### Added

- Dedicated courier poses for remaining empty states (#142): Screener,
  scheduled, reply later, drafts, files, contacts, groups, sender
  threads, and calendar connect. Each has a full-body cutout with a
  cream halo in dark mode.

## [v2026.49] - 2026-08-28

### Added

- Courier mascot on remaining empty states (#141): Sent, archive, snoozed,
  scheduled, drafts, follow-up, reply-later, files, contacts, groups,
  calendar connect, and a real Screener empty state.

### Fixed

- Send paths now share ingest's thread assignment (#137): new mail gets its
  own Message-ID as threadId, replies unify with a null-threadId anchor
  immediately, and repair is References-aware so replies stay in their
  thread.
- Sent-folder sync (#138): reconciliation dedupes by Message-ID instead of
  uid sign, repairs threading, and servers without \Sent get that mailbox
  labeled so append and poll work.

## [v2026.48] - 2026-08-27

### Added

- Per-list courier poses: Imbox delivers a letter, The Feed reads a
  newspaper, Paper Trail sorts receipts. Empty states use full-body
  cutouts with no terracotta tile.
- Dark-mode cutouts with a cream halo so hair and sandals still read
  on dark paper.

### Changed

- The native iPhone and Mac app icon is the courier close-up. iOS 18
  dark appearance uses a deeper clay field.

## [v2026.47] - 2026-08-27

### Added

- The courier mascot (#136): a round chibi courier in cream tunic and
  terracotta sash is now the product's face. She greets you on the
  sign-in screen, fills the empty mailbox and empty search results, and
  is the figure on kurir.io. The K lettermark stays the sidebar mark on
  the web client and the app icon.

### Changed

- Favicon, apple-touch-icon, and the PWA icons (192 and 512) are the
  courier close-up instead of the serif K.
- kurir.io swaps the serif K in the header, footer, and favicon for the
  courier, and the hero shows the full-body running figure.

## [v2026.45] - 2026-08-26

### Added

- Compose assistant (#133): the composer's sparkles button opens a panel
  instead of firing blindly. Say what the mail should say, pick a tone
  (Auto, Formal, Friendly, Direct), generate, flip between versions, and
  insert the one you want. Nothing reaches the composer until you insert,
  so generation never overwrites typed text, and versions are gone when
  the composer closes.
- Instructed generations can go looking for their own context: two bounded,
  user-scoped tools let the model search the mailbox and read a message, so
  a mail about "the invoice thread from March" gets its facts right. Capped
  at 6 lookups per generation, and both provider adapters run their API's
  native tool-use loop. An empty instruction stays the old one-tap path -
  seeded context pack only, same speed as before.
- New mail with an empty subject line can come back with a proposed
  subject; a subject you already typed is left alone.
- Settings links to the documentation site (#132): a Documentation row to
  kurir.io/docs, and a setup-guide link from the Draft generation section
  to kurir.io/docs/draft-generation.

### Compatibility

- An app without the assistant keeps the old contract byte for byte. An app
  with it against an older server says "Update the server" rather than
  silently dropping the instruction.

## [v2026.44] - 2026-08-26

### Added

- Generated reply drafts (#130): paste a Claude Code setup-token
  (`claude setup-token`) or a Grok Build session in Settings, and the
  composer's Generate draft button writes an editable draft from the mail
  being answered plus recent correspondence with that sender (8 from the
  sender + 5 own-sent, quote-stripped and truncated). The body lands on the
  normal Draft row, so it appears in Drafts on web, iPhone, and Mac.
- The credential is stored encrypted with the same key as IMAP passwords,
  is never echoed to clients, and is excluded from settings backups.
  Pay-per-token API keys (`sk-ant-api…`, `xai-…`) are refused so the
  feature can never start a metered bill. Disabled on the demo instance,
  and generation is rate limited tighter than ordinary mail actions.
- New mobile API under `/api/mobile/draft-generation` (status, save,
  remove, generate) — the native apps are thin clients of the same module
  as the web composer.

## [v2026.41] - 2026-08-25

### Added

- The web day view adopts the iOS day agenda design (kurir-ios#54), and the
  now line reflects actual time (kurir-ios#64 mirror, #120): a free or gap
  span straddling now is clipped to its remaining minutes, "longest stretch"
  is chosen by what remains, and an ongoing event is marked as current
  instead of getting a line under it. Other days render untouched.
- The calendars aside is gone; the Calendars dialog from the masthead serves
  desktop too (kurir-ios#56).

### Fixed

- Subject rules match reliably (kurir-ios#59): the creation sweep and ingest
  share one unicode-safe matcher - `%` and `_` are literal, both sides are
  NFC-normalized and case-folded (a pattern typed on iOS with åäö matches at
  ingest), and encoded-word subjects are decoded before matching and storing.
  The IDLE ingest path is covered by integration tests.
- Sender-level moves no longer re-file mail a subject rule placed
  (kurir-ios#60): the own-sender auto-approve during sync, the
  `approveOwnPendingSenders` maintenance task, and unarchive all respect
  subject-rule provenance; unarchive places rule-filed messages per the
  rule's category.
- Subject rules match across reply/forward prefixes (kurir-ios#58).
- Archive undo races closed (#61, #126): an undo or re-archive landing in
  the middle of the deferred IMAP move now gets a compensating reverse move
  instead of stranding the message in the wrong IMAP folder.
- Optimistic archive suppresses unthreaded-sender sibling rows immediately
  (#62), mirroring the server-side thread expansion.
- The updater verifies the running version after an update and flags a stale
  sidecar instead of reporting false success (kurir-ios#57).

## [v2026.39] - 2026-08-25

### Added

- Subject screening rules (kurir-ios#48-#50): screen individual emails by
  what their subject contains. A rule pairs a scope (an exact address, a
  domain, or `*.domain`) with a case-insensitive "subject contains" phrase
  and a verdict (Imbox / The Feed / Paper Trail / screen out), and is
  evaluated per message at ingest - other mail from the same sender keeps
  following the sender's own decision. Created from an open thread via the
  new "Screen subject" popover (pre-filled with the message's subject),
  managed in the Screener's screened list. Creating a rule retroactively
  re-files existing matching mail, screen-out matches are archived on the
  IMAP server too, and subject-rule placements outrank later sender-level
  moves. Mobile clients get create/change/delete actions and a replace-all
  `subjectRules` sync field; settings backups round-trip the rules.

## [v2026.38] - 2026-08-25

### Fixed

- Every calendar surface drew the wrong wall-clock time because the account
  timezone was an unreachable `UTC` default (#37). The column is now
  nullable (null = never chosen): the mail layout adopts the zone the
  browser reports on the next visit, and Settings -> Account -> Profile
  gets a Timezone field that accepts any IANA zone - an explicit UTC
  included, which adoption never overwrites. The apps inherit the adopted
  zone through mobile calendar sync with no client change.

## [v2026.36] - 2026-08-25

### Added

- Mobile message payloads (sync and search) carry the user's RSVP answer on
  meeting invites, computed from the linked calendar event's self attendee
  the same way the web meeting card does. The native meeting card uses it
  as its baseline, so replies made on the web show up on iPhone and Mac.

## [v2026.33] - 2026-08-24

### Added

- The mobile calendar sync payload carries the account's timezone, so the
  iPhone and Mac apps draw the calendar in the same zone the web does
  instead of the device's.

### Changed

- A new `vYYYY.MICRO` tag is beta. It writes `latest.json.beta` and
  publishes the versioned image without moving `:latest`. Marking that
  version stable copies the pointer onto the top-level fields, clears
  the GitHub prerelease flag, and retags `:latest` onto the same image.
- Turning Install betas off while running an unmarked version now says
  the instance is ahead of stable and offers a reinstall of the latest
  stable image. Applied migrations are not reverted.

## [v2026.31] - 2026-08-24

### Added

- Admin -> Updates has an Install betas switch. Tagged YYYY.MICRO
  versions that have not been marked stable show up only with that
  on. Same number, same image. Existing instances stay on stable.

## [v2026.30] - 2026-08-24

### Added

- Subscribe to a public ICS calendar URL. Paste a webcal or https feed
  and Kurir fetches it as a read-only calendar. Private destinations
  and URLs with userinfo are refused; demo instances do not fetch.

## [v2026.29] - 2026-08-24

The first release numbered `YYYY.MICRO`: a four-digit year and one serial
per year, shared with kurir-ios. `2026.29` continues the old serial after
`v2026.08.28`, and it ranks above that release under component-wise
comparison (`08 < 29`).

**Instances older than `v2026.08.28` must be updated by hand.** That
release carries the tolerant manifest parser. An instance that never
picked it up cannot read a two-component `YYYY.MICRO` manifest: it logs
a parse failure, reports "no update", and stays there until someone
pulls a newer image manually.

### Changed

- Version numbers are `YYYY.MICRO`. This is `2026.29`, one greater than
  the last `YYYY.MM.N` serial (`v2026.08.28`).

## [v2026.08.28] - 2026-08-24

The last release numbered `YYYY.MM.N`. It carries the tolerant manifest
parser, so this instance can read the two-component `YYYY.MICRO` manifests
that follow. An instance that never picks this release up cannot read them
at all and has to be updated by hand.

### Fixed

- Apple's CalDAV sends `calendar-color` with an alpha channel (`#CB30E0FF`)
  and the colour normaliser accepted only 3- and 6-digit hex, so every iCloud
  calendar and every event in it drew in the fallback grey. The alpha is now
  dropped instead of the colour.

### Changed

- The update checker accepts two-, three- and four-component versions, so a
  `YYYY.MICRO` manifest parses. Releases are still written in one shape only.
- `verify-release.sh` requires `YYYY.MICRO`, with a one-release exception for
  this version.

## [v2026.08.26] - 2026-08-23

### Fixed

- CalDAV discovery filters out reminder (VTODO) collections, so iCloud's
  legacy "Påminnelser ⚠️" list no longer appears as a calendar. Collections
  with an empty component set are probed for VTODOs, failing open.
- The calendar sync worker deletes calendars that vanished remotely and never
  produced an event, so stale reminder rows clean themselves up on the next
  sync. Calendars with events keep the soft-hide behavior.

### Changed

- Today is marked with a filled primary-color date circle in the calendar's
  week header and month grid.

## [v2026.08.25] - 2026-08-23

### Fixed

- A birthday repeating once a year appeared on the same date every month.
  Apple writes an annual birthday as `FREQ=YEARLY;BYMONTHDAY=3` and renders it
  once a year, as do Google and Microsoft, but read strictly that rule means
  the 3rd of _every_ month: BYMONTHDAY expands inside the yearly period and,
  with no BYMONTH, nothing narrows it back down. A yearly rule that pins a day
  of the month now takes its month from DTSTART unless BYMONTH, BYWEEKNO or
  BYYEARDAY already scopes it. Calendars holding such a rule resync once on
  upgrade so their stored occurrences are rebuilt; an incremental pull would
  never have touched an unchanged birthday.

## [v2026.08.24] - 2026-08-23

### Fixed

- A calendar with thousands of events never finished its first sync. The
  pull writes one event per round-trip inside a single transaction, and
  Prisma's default interactive-transaction timeout is 5 seconds - a calendar
  holding 4023 events blew past it about four fifths of the way in, died with
  "a query cannot be executed on an expired transaction", never wrote its sync
  token, and retried into the same wall forever at zero events. The pull
  transaction now gets 120 seconds; incremental pulls afterwards carry a
  handful of objects and are unaffected.
- A single reminder stored inside a calendar stopped every event in that
  calendar from syncing. iCloud keeps reminders as VTODO objects in ordinary
  calendar collections and reports an empty supported-calendar-component-set,
  so there is no way to filter such a collection out up front. One VTODO threw
  and took the whole calendar's pull with it. An object that is not a readable
  event is now skipped, which also covers a malformed ICS from any provider.

## [v2026.08.23] - 2026-08-23

### Fixed

- iCloud calendars never pulled a single event. iCloud answers a
  sync-collection REPORT with etags only, never calendar-data, so every
  object goes through calendar-multiget - and it answers 404 to an absolute
  href there while serving the same href written as a path. tsdav throws on
  the first 404 in the multistatus, so one absolute href killed the whole
  calendar's pull. Requests now carry the path form; provider ids stay
  absolute. Every iCloud calendar had been stuck at zero events since the
  CalDAV adapter landed.

### Added

- A calendar's own sync error is now visible. It was recorded per calendar
  but never selected or rendered anywhere, so a calendar whose pull had died
  drew exactly like a calendar with nothing in it. It now travels to the
  calendar rail, the settings DTO and the mobile wire, and shows under the
  calendar's name.

## [v2026.08.22] - 2026-08-23

### Added

- The calendar mobile endpoints return normalized attendees, so the native
  apps can show who was invited and how each of them replied.

### Fixed

- Editing or deleting a single occurrence of a repeating event acted on the
  series' first occurrence instead of the one that was picked. Every instance
  the API returns carries the series master's id, and the write contract had
  no way to say which occurrence was meant, so the server fell back to the
  master's own start. For "this and following events" that set the rule's
  UNTIL to one second before the series began, which left no occurrences at
  all and deleted the whole series at the provider, history included. The
  PATCH body and the DELETE query now carry an `occurrence`, and both fall
  back to the old behaviour when it is absent. The web client does not send
  it yet and is unchanged.

## [v2026.08.21] - 2026-08-22

### Changed

- Calendar day view rebuilt as a HEY-style filmstrip: one continuous
  proportional timeline with full-height calendar-color slats, collapsing
  starfield night bands, and sticky day labels.
- Week and month share the day view's solid calendar-color event chrome,
  serif day numerals, and quieter freetime labels.

### Added

- Drag to create in the day view: mark a time span to open the event
  dialog prefilled with the snapped range.
- Drag to move events in the day view - across days too - committed
  through the same path as the week grid, including the recurrence
  scope dialog.

## [v2026.08.20] - 2026-08-20

### Added

- Shared list contract: same row chrome, actions, and empty copy across
  mailboxes.
- Per-list search via `GET /api/mobile/search?category=` so native apps
  can filter hits to the open mailbox.
- Read and Block sender on the list select bar.
- Infinite Sent list with select and keyboard, without archive/snooze.
- Files list infinite-scrolls and opens the containing thread in the
  right folder.
- `PATCH /api/mobile/scheduled/:id` so native Edit can update a scheduled
  send without cancel-and-recreate.

### Changed

- List rows show a two-line snippet, `·N` thread counts, an attachment
  paperclip, and follow-up time when one is set.
- Leading swipe marks a conversation read. Trailing swipe archives (or
  unarchives in Archive).
- Search results use the same actions as the list they were opened from.

## [v2026.08.19.3] - 2026-08-19

### Changed

- Inbox hover actions now spell out Follow up, Snooze and Archive instead of
  anonymous F/S/E glyphs. Hidden until hover.

## [v2026.08.19.2] - 2026-08-19

### Fixed

- APNs alert payloads now set `content-available` so a running iOS or
  Mac app can sync incoming mail without the user focusing the window.

## [v2026.08.19] - 2026-08-19

### Added

- Reply drafts (including those saved via MCP) show the original sender
  and subject in Drafts instead of an empty "(no subject)" row.
- Opening a reply draft lands on the thread in the right folder with the
  reply composer already open on the saved text.
- MCP `get_thread` returns the in-progress reply draft. `save_draft` for
  a reply requires a real message id, not a thread id.

## [v2026.08.18.4] - 2026-08-18

### Added

- Large attachments can be uploaded in chunks via MCP `upload_attachment`
  and JSON `POST /api/attachments/upload`. Slice raw file bytes (not a
  base64 string), about 250 KB per call. A 1.5 MB PDF no longer has to
  travel as one tool argument.

## [v2026.08.18.3] - 2026-08-18

### Fixed

- Opening a draft no longer shows a fake Attachment 0 B chip. Filename and
  size come from the stored attachment row.
- Saving or deleting a draft (including via MCP) invalidates the web Drafts
  page so it matches the Mac app instead of a stale cache.

## [v2026.08.18.2] - 2026-08-18

### Fixed

- MCP attachments no longer land as empty 0-byte files. Small PDFs are
  inlined as base64, uploads accept data URLs and base64url, and empty
  stored bytes are treated as missing so IMAP can fetch the real part.

## [v2026.08.18] - 2026-08-18

### Fixed

- MCP attachments no longer land as empty 0-byte files. Small PDFs are
  inlined as base64, uploads accept data URLs and base64url, and empty
  stored bytes are treated as missing so IMAP can fetch the real part.

## [v2026.08.17.2] - 2026-08-17

### Fixed

- Settings backup Off / Daily / Weekly stay clickable after you pick one.
  Changing cadence no longer refetches the whole Settings page.

## [v2026.08.17] - 2026-08-17

### Added

- Settings takeout stored as a dummy Sent email (no SMTP). The attached
  JSON holds contacts, groups, screener decisions, domain rules, per-sender
  flags, and mail preferences - never message bodies. Backup now, or
  schedule daily/weekly at 03:00 local. The last 4 copies are kept.
  After a fresh install, pick a backup from Sent in setup or restore later
  from Settings. Scheduled success requires IMAP APPEND so the copy
  survives a wipe.

## [v2026.08.16.5] - 2026-08-16

### Changed

- The Docker image now carries the Kamal `service=kurir` label, so the
  CI-built `ghcr.io/cfarvidson/kurir-server:vX` image can be rolled out with
  `bin/deploy deploy --skip-push --version vX` instead of a local build and
  push. Release docs and CLAUDE.md describe the ghcr.io registry and the new
  deploy command

## [v2026.08.16.4] - 2026-08-16

### Fixed

- Sending a mail now deletes its originating draft server-side.
  `POST /api/mail/send` and the MCP `send_mail` tool accept an optional
  `draft` (`type` + `contextMessageId`, the same key as `save_draft`); once
  SMTP has accepted the mail the draft row is removed, so cleanup no longer
  depends on the client's own delete call succeeding. The web composer passes
  the key; a failed cleanup is logged and never turns a successful send into
  an error

## [v2026.08.16.3] - 2026-08-16

### Fixed

- Claude Code now loads Kurir's MCP tools after connecting. Every JSON-RPC
  result carries `resultType` (`complete` unless a tool asks for
  confirmation), which the 2026-07-28 revision requires, and `tools/list`
  uses `cacheScope: "private"` instead of the invalid `"server"`

## [v2026.08.16.2] - 2026-08-16

### Fixed

- Claude Code can now connect to `/mcp`. `server/discover` returns
  `supportedVersions` (and `serverInfo` in `_meta`) as the 2026-07-28
  DiscoverResult requires; without it clients treated Kurir as a legacy
  server, fell back to `initialize`, and got "Unsupported protocol version"
  (-32600)

## [v2026.08.16] - 2026-08-16

### Fixed

- Connecting Claude Code via `/mcp` no longer fails with "Invalid redirect".
  OAuth consent now accepts loopback redirect URIs (`http://localhost`,
  `http://127.0.0.1`) on any port, as required by RFC 8252 §7.3, since native
  clients bind an ephemeral port

## [v2026.08.15.2] - 2026-08-15

### Added

- Remote MCP server (spec 2026-07-28) at `POST /mcp` so Claude and other
  clients can use Kurir over HTTP
- Passkey OAuth consent for MCP connectors (CIMD, PKCE). Revoke under
  Settings → Connected apps
- MCP tools for mail (list, search, thread, archive, snooze, follow-up,
  reply-later), screener, contacts, drafts, scheduled send, files, and
  own-account settings
- Extra confirmation (MRTR) before send, reject, and other destructive
  actions

### Fixed

- Production TypeScript build no longer fails when creating an MCP
  attachment upload

## [v2026.08.15] - 2026-08-15

### Added

- Remote MCP server (spec 2026-07-28) at `POST /mcp` so Claude and other
  clients can use Kurir over HTTP
- Passkey OAuth consent for MCP connectors (CIMD, PKCE). Revoke under
  Settings → Connected apps
- MCP tools for mail (list, search, thread, archive, snooze, follow-up,
  reply-later), screener, contacts, drafts, scheduled send, files, and
  own-account settings
- Extra confirmation (MRTR) before send, reject, and other destructive
  actions

## [v2026.08.14.2] - 2026-08-14

### Fixed

- Closed a hole where any signed-in user could read or create contacts under another account
- Rejected mail no longer disappears from the app if the IMAP archive move fails
- Undo after screening out a sender now brings the mail back from the archive
- Compose no longer sends twice on a double-click
- Sending a scheduled message now (or undoing it) no longer loses the copy if you refresh during the undo window
- Drafts keep Cc/Bcc and attachments, including files forwarded from IMAP
- Tracker images hidden in CSS comments are blocked
- The image proxy pins DNS so it no longer follows rebinding to internal addresses

## [v2026.08.14] - 2026-08-14

### Fixed

- Sign-in, register, and other auth pages scroll again when the content is
  taller than the viewport. The global mail-UI overscroll fix locks document
  scrolling, which left anything below the fold unreachable on these pages —
  most visibly the demo credentials form inside the iOS app's narrow sign-in
  sheet.
- Demo instances now show the demo credentials form first on the sign-in
  page, above the passkey button, so it is visible without scrolling.

## [v2026.08.13] - 2026-08-13

### Changed

- Drafts catalog: every row has a labeled Delete button and asks before removing the draft
- Drafts rows use the same hierarchy as the mail lists: Reply / Forward / New, a To: line, and relative timestamps

### Added

- Mouse back (and Esc) closes the open mail and returns to the previous conversation, or the list if that was the first one

## [v2026.08.11] - 2026-08-11

### Added

- Drafts catalog: every draft - new mail, replies, forwards - in one browsable list, at `/drafts` on the web, in the iOS More tab, and in the macOS sidebar (with live count) between Scheduled and Sent
- Multiple parallel new-mail drafts: each compose autosaves under its own client-generated draft key instead of overwriting a single shared slot

### Fixed

- Reopening a draft restores its attachments instead of silently dropping them on the next autosave

## [v2026.08.09] - 2026-08-09

### Fixed

- Self-host: the generated Docker Compose file (and `docker-compose.production.yml`) now passes `PUSH_RELAY_URL` to the app container, defaulting to the hosted APNs relay - iOS push notifications previously never worked on self-hosted installs. Set `PUSH_RELAY_URL=` (empty) in `.env` to opt out. Existing installations need to add the line to their compose file or re-run the installer; image updates alone do not change the compose file
- Push: when neither APNs keys nor `PUSH_RELAY_URL` are configured, iOS subscriptions are now skipped with a clear `iOS push not configured` warning instead of attempting a relay send against an undefined URL and logging `relay unreachable` on every push

## [v2026.08.06.3] - 2026-08-06

### Added

- Mobile: the sync payload now carries the user's remote-image policy (`imagePolicy`: block all / block trackers / allow all), so the iOS/macOS app mirrors the web privacy behavior — including the "load images, block trackers" middle ground with its trackers-blocked badge

## [v2026.08.06.2] - 2026-08-06

### Added

- Screen domains retroactively (plan 034): a "Screen domain" action in the thread header and on screened-list rows creates a domain rule from an existing sender. The origin sender always follows the rule (matching pending senders are swept as before); other already-decided senders are never touched
- Mobile: the `createDomainRule` action now moves the origin sender with the rule, so the iOS/macOS "Screen domain" menus work from the thread view, message list and screened list

## [v2026.08.06] - 2026-08-06

### Added

- Domain screening rules (plan 033): a scope selector in the screener lets a decision apply to just the sender, the whole domain, or a subdomain wildcard (`*.github.com`). Rules approve into a category or screen out, apply automatically to new senders at sync (own addresses always win), and retroactively sweep matching pending senders when created. Rules appear at the top of the screened list with the same category/remove affordances as sender rows
- Mobile API: `createDomainRule`, `changeDomainRuleCategory` and `deleteDomainRule` actions, plus a `domainRules` field in the sync payload (replace-all) for the iOS/macOS app

## [v2026.08.05.1] - 2026-08-05

### Fixed

- Settings: connection-card actions (catch-all toggle, aliases, send-as, set-default, delete) no longer lock up permanently when a request fails or stalls. Requests now time out (30s; 5 min for sync), server errors surface as an inline message on the card, and a failed action re-enables the controls instead of replacing the settings page with the error boundary
- Admin: the Updates changelog had not been updated since April — backfilled all releases from v2026.04.21 through v2026.08.05, and updating it is now a required step of the release process

## [v2026.08.05] - 2026-08-05

### Added

- Catch-all domains: a per-connection "Treat every address on this domain as mine" setting (`treatDomainAsOwn`) makes every address on the connection's domain count as the user's own — in Screener exclusion, sync-time auto-approve, All Mail classification, follow-up detection, and the mobile sync payload
- Settings: catch-all toggle on the connection card next to alias management
- Setup wizard (password flow) now collects aliases and the catch-all setting, so they apply from the very first sync

### Fixed

- Stale `PENDING` "ghost" sender rows for the user's own addresses (created before an alias was configured) are now swept to approved/Imbox — hourly, and immediately when aliases, send-as, or the catch-all setting change. Together with the iOS app persisting connections locally, this removes the old alias mail that flashed in the Screener at cold start

## [v2026.08.04] - 2026-08-04

### Fixed

- Fresh self-host installs never got a database schema: the container entrypoint now bootstraps an empty database with `prisma db push` plus all ad-hoc SQL migrations, while non-empty databases (e.g. the shared production instance) are still never pushed
- The `search_vector` full-text-search migration silently failed on every boot — Prisma 7 removed `db execute --schema`; the flag is dropped and real failures are now visible in the logs
- Container healthcheck used `localhost`, which BusyBox wget resolves to `::1` while Next.js binds IPv4 only, so the app could never report healthy; now probes `127.0.0.1`
- `install.sh` reported "All services are running" for an unhealthy app (`grep -q "healthy"` also matches "unhealthy"); the wait loop now requires an exact health-state match
- Redis eviction policy changed from `allkeys-lru` to `noeviction` — BullMQ requires it, and eviction could silently drop queued jobs
- Rolling-release distros without `VERSION_ID` (e.g. Arch) were reported as "arch 0" by the installer

## [v2026.07.24] - 2026-07-24

### Added

- Mobile API for the native iOS client: sync, search, actions, compose/send with dual session/bearer auth, and APNs push registration (M1–M6).
- Mobile full-text search endpoint backed by the same FTS index as the web.
- Sync and search payloads now carry a flat `folderRole` so the iOS app can show a Sent list.
- The message body endpoint returns attachment metadata (`id`, `filename`, `contentType`, `size`) so clients can list and open attachments.

### Changed

- Sharpened editorial redesign across the web client; screener uses category icons instead of dots.

### Fixed

- View switching in the mobile PWA feels instant.

## [v2026.06.22] - 2026-06-22

### Fixed

- Eliminated a UI freeze in the PWA when navigating between views and performing actions, making the interface noticeably snappier.

## [v2026.06.11] - 2026-06-11

### Changed

- Marking a thread Reply Later now removes it from the Imbox, Feed, and Paper Trail lists (and their unread badge counts) until the flag is cleared, mirroring how snoozed messages behave. Deferred threads no longer linger in the lists they were deferred from.

## [v2026.06.10.2] - 2026-06-10

### Added

- A third remote-image privacy mode: **Load images, block trackers**. In addition to "Block all remote images" (the default) and "Load all remote images", you can now load ordinary content images while still stripping known email trackers and invisible spy pixels (1×1 / 0px / `display:none` images). Detection runs before any network request fires, so blocked trackers never load. A new Privacy section in Settings → Mail lets you choose the mode, and tracked threads show a compact "N trackers blocked" indicator. Per-sender trust and the one-time "Load images" action continue to load everything.
  - **Self-hosting note:** this adds a `blockTrackers` column to the `User` table (default `true`). Because the production database shares its instance with another app, apply it as explicit SQL rather than `prisma db push` — the statement is in `prisma/migrations/tracker_blocker.sql` (idempotent `ADD COLUMN IF NOT EXISTS`). **Run it before deploying the new app image**, since the thread and settings pages `SELECT` the column and will error if it is missing: `bin/deploy app exec --reuse "psql \"$DATABASE_URL\" -f -" < prisma/migrations/tracker_blocker.sql`.

### Fixed

- Push notifications in the PWA now work reliably. The VAPID public key was inlined into the client bundle at build time while the private key was read (and could be auto-generated) at runtime, so the two could drift apart and pushes would silently fail to deliver. The public key is now served from a runtime endpoint, making the runtime environment the single source of truth for both keys. The settings screen now shows a clear message when subscribing fails or when push is not configured on the server, instead of a dead "Enable" button.
  - **Self-hosting note:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is no longer a Docker build argument — it is read at runtime like `VAPID_PRIVATE_KEY`. Ensure both keys are present as runtime environment variables (and unchanged across deploys); a build-arg-only configuration will now serve no public key.

## [v2026.06.10] - 2026-06-10

### Changed

- Archiving a thread from the thread view is now instant. It navigates back to the list immediately instead of freezing the UI for a few seconds while the server action completes.

### Fixed

- New mail (including login codes) now arrives within seconds. IMAP IDLE events were being dropped while a full sync held the sync lock, and IDLE connections only started lazily on the first sync job after a restart; they now defer-and-retry under the lock and start at boot with a downtime catch-up.
- Removed a faint extra border on undo toasts.

## [v2026.06.04] - 2026-06-04

### Changed

- Removed initial-circle avatars app-wide, including the remaining ones in screener sender lists.

### Fixed

- Snooze: preserve read state so only unread mail is marked unread on wake.
- Scheduled messages: prevent double-send when using "Send now" within the undo window.

## [v2026.06.03] - 2026-06-03

### Added

- Contact groups: organize contacts into named groups.
- Compose: support multiple recipients in both immediate and scheduled sends.

### Changed

- Reading pane: editorial redesign with a serif subject line and calmer avatars.
- Message list: cleaner rows that reserve brand color for signal.
- Sidebar: refreshed with cleaner design tokens, extended to the mobile tab bar.
- Toast: unified pop-up notification styling across all notification types.
- Compose: editing a scheduled message now returns to the origin view on cancel.

## [v2026.05.31] - 2026-05-31

### Added

- Attachments: PDF previews now render inline on iOS via pdfjs, where the native iframe viewer fails.

### Fixed

- Snooze: corrected the snooze label shown on snoozed messages.
- Categorization: archiving a message no longer leaks it into Reply Later or Follow-Up.
- Badge preferences: fixed an authorization check on the badge-preferences endpoint.
- Mobile (PWA): restored desktop/PWA navigation parity on the mobile tab bar.

## [v2026.05.30.2] - 2026-05-30

### Added

- Reply Later: stack messages you want to get back to and work through them in a dedicated focus mode, one at a time.
- Privacy: a spy-tracker blocker that strips tracking pixels and proxies remote images so senders can’t see when or where you open their mail.

### Fixed

- Mobile (PWA): vertical scrolling in list views no longer accidentally triggers swipe-to-archive — only deliberate horizontal swipes archive a row.

## [v2026.05.30] - 2026-05-30

### Added

- Files library: a new read-only `/files` page that browses every attachment across your mail, newest first. Filter by type (images, documents, archives, other), search by filename, and page through with "Load more". Jump to it with the `g+l` keyboard shortcut. Downloads reuse the existing attachment route.
- Mobile (PWA): attachments now open through the native iOS share sheet, so you can save to Files, share to other apps, or AirDrop directly.

### Fixed

- Mobile (PWA): the app no longer freezes during bursts of realtime activity. All refreshes now route through a single debounced scheduler that coalesces SSE event storms, and the realtime connection is tied to tab visibility (closed when backgrounded, reconnected with a single refresh on resume) so iOS no longer replays buffered events into a refresh storm on app resume.

## [v2026.05.20] - 2026-05-20

### Added

- Un-thread emails from noisy senders. Toggle in the thread detail header next to the message count: each message from that sender renders as its own row in list views and opens a single-message detail view. Reversible at any time; no data is mutated.

### Fixed

- Mobile (PWA): iOS swipe-back and other user-initiated back gestures now navigate back to the list instead of being silently swallowed. Top-level pages still resist accidental edge-swipes that would exit the app.
- Mobile: toasts now sit above the bottom tab bar and the thread action bar instead of being hidden behind them — the Undo button inside an undo-toast is finally reachable.

## [v2026.05.15] - 2026-05-15

### Fixed

- Compose preview: paragraph breaks in the markdown preview now render correctly.

## [v2026.04.26.3] - 2026-04-26

### Fixed

- Reply composer now preserves a custom To address when you press Enter or click away — useful when you want to forward a reply to someone else. Previously the field reset back to the original sender as soon as editing finished.

## [v2026.04.26.2] - 2026-04-26

### Changed

- Email body now renders in a Shadow DOM instead of an iframe. The content shows up in the same paint (no more pop-in flash after a beat) and on mobile the page scrolls naturally because touch gestures are no longer trapped by the iframe. CSS isolation and the sanitizer guarantees are unchanged.

## [v2026.04.26] - 2026-04-26

### Changed

- Mobile thread view: hide the duplicate header action buttons in Imbox / Feed / Paper Trail so the bottom action bar is the single archive/snooze/follow-up surface on phones.
- Swipe-left on a message row now snoozes to tomorrow 8 AM local with a 5-second undo toast, instead of opening a popover anchored to a hidden element. The snooze picker is still available via the keyboard `s` shortcut and the desktop hover button.

### Fixed

- Imbox / Feed / Paper Trail no longer show stale list data after approving, rejecting, or recategorizing a sender — the React Query messages cache is invalidated alongside the existing server-side `revalidatePath`.

## [v2026.04.21] - 2026-04-21

### Added

- Reply All with Cc and Bcc support. Compact "Reply all" trigger chip inside the reply button, editable Cc/Bcc rows with `+ Add Cc` / `+ Add Bcc` affordances, and a new keyboard shortcut `a` for reply-all.

### Changed

- Upgraded major dependencies: Next.js 15 → 16, Prisma 6 → 7, Tailwind CSS 3 → 4, TypeScript 5 → 6, Zod 3 → 4, ESLint 9 → 10, framer-motion → motion 12.

### Fixed

- Deploy: Prisma 7 compatibility — added `prisma.config.ts`, dropped the removed `--skip-generate` flag from the entrypoint and post-deploy hook, symlinked global `prisma` so the config file resolves inside the runner image.
- Deploy: extended healthcheck timeout to 120s so Next.js 16 cold boots don't roll back.
- Build: replaced pre-existing invalid `"outline-solid"` Button variants that blocked the Next.js 16 type-check.

---

Earlier versions are tracked in the [GitHub releases page](https://github.com/cfarvidson/kurir-server/releases).
