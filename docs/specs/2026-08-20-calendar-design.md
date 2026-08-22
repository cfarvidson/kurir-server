# Calendar (HEY-shaped client) - design

Date: 2026-08-20. Status: approved (dialog + file review 2026-08-20).

Kurir has no calendar today. Mail already has IMAP sync, Google/Microsoft
OAuth for mail scopes, a BullMQ worker, a mobile delta API, and a native
app in `kurir-ios`. This spec adds a calendar client that shows and edits
calendars the user already has, with a week-first UI in Kurir's editorial
language.

Two repos: `kurir-server` (web, sync, mobile API) and `kurir-ios` (iOS +
macOS). Two implementation plans after this spec, server first.

HEY Calendar is the UX reference (week as home, day as a timeline,
freetime as empty space). It is not the data model. HEY stores events in
HEY. Kurir stores a replica of Google, Microsoft, and CalDAV, and writes
back.

## Goal

A person who already lives in Google Calendar, Outlook, or iCloud opens
Kurir and sees this week, today as a timeline, and a month they can jump
through. They create, move, and delete events in Kurir and the change
lands on the source. A meeting invite in Imbox shows time and place.
Accept / Maybe / Decline puts the event on a calendar and answers the
organizer.

## Non-goals (this round)

- Kurir as the canonical store (no "Kurir calendar" that other apps
  subscribe to, no CalDAV server)
- Journal, habits, photos, time tracking, highlights, countdowns, day
  labels, "sometime this week"
- Kurir-sent reminders or push for upcoming events (Google, Outlook, and
  Apple keep doing that)
- Standalone `webcal://` / ICS URL subscriptions
- Sharing a calendar with another Kurir user
- Propose-a-new-time / COUNTER
- Calendar MCP tools
- Google Watch channels and Graph change notifications (poll only)
- Adding calendar scopes onto `EmailConnection` tokens
- A shared TypeScript/Swift UI kit
- A dedicated month page as the default home (month exists, week is home)

## Locked decisions

- Source of truth: the provider. Postgres is a replica. Writes go
  adapter then source then confirm.
- Providers in v1: Google Calendar API, Microsoft Graph, CalDAV (iCloud,
  Fastmail, Nextcloud, anything that speaks CalDAV).
- Surface: week home, day timeline, month as a third mode, freetime,
  colored calendars, CRUD, recurrence this / this and following / all.
- Clients: web + iOS + macOS in one sweep.
- Meeting invites: parse ICS at mail sync, card on the thread, RSVP
  creates the event if the UID is missing.
- Architecture: local replica, three adapters behind one interface,
  BullMQ poll every 2 minutes, no webhooks.
- Credentials live on `CalendarAccount`, never on `EmailConnection`.
  `emailConnectionId` is an optional label for grouping in settings.
- Recurrence: store masters + exceptions. Materialize instances for
  now-2 months through now+18 months. Range API may expand outside that
  window on the fly and not persist those rows.
- Reminders: the source reminds. Kurir does not.
- Demo instance: seeded calendar, worker no-ops, no real provider calls.

## Architecture

```
Google Calendar API  --\
Microsoft Graph      ---- adapter --> CalendarAccount / Calendar /
CalDAV (iCloud, ...) --/            CalendarEvent / Instance
                                         |
                    BullMQ sync-calendar |
                                         v
                              Postgres replica
                                         |
              +--------------------------+------------------+
              |                          |                  |
              v                          v                  v
        web /calendar            GET /api/mobile/     thread Meeting
        server actions           calendar/*           card + RSVP
                                         |
                                         v
                                    kurir-ios
```

UI never talks to Google, Graph, or CalDAV. Every read is Postgres.
Every write is a server action or mobile POST that calls the adapter,
then updates the replica.

Mail sync stays on `sync-connection`. Calendar gets its own queue,
`sync-calendar`. A stuck calendar lock must not block IMAP.

Code lives in `src/lib/calendar/`, not under `src/lib/mail/`. Server
actions in `src/actions/calendar.ts`. ICS parse is the one mail-sync
hook: `processMessage` may call `src/lib/calendar/ics.ts` and write a
`MessageMeeting` row. A bad ICS file must not fail the mail sync.

## Data model

New Prisma models, `userId` on every row. Migration `0015_calendar.sql`,
idempotent (`IF NOT EXISTS`, guarded `CREATE TYPE`). Next free number
after `0014_settings_backup.sql`.

### CalendarAccount

One connected source.

- `provider`: `GOOGLE` | `MICROSOFT` | `CALDAV`
- `displayName`, `principalEmail` (for RSVP defaulting and settings)
- `emailConnectionId` optional, on-delete set null. Label only.
- Google / Microsoft: `oauthAccessToken`, `oauthRefreshToken`,
  `oauthTokenExpiresAt`, `oauthError`. Encrypted AES-256-GCM, same
  helpers as `EmailConnection`.
- CalDAV: `caldavUrl` (calendar-home or principal), `caldavUsername`,
  `encryptedPassword`.
- Sync lock: `isSyncing`, `syncLockToken`, `syncLockAt`, `lastSyncedAt`,
  `lastError`. Stale lock clears after 5 minutes, same as IMAP.

Google and Microsoft tokens are minted by a calendar OAuth flow that
requests calendar scopes only. Do not reuse the mail refresh token. Same
Google/Microsoft client IDs as mail are fine. Incremental consent is
allowed as a UX convenience. The resulting tokens still persist on
`CalendarAccount`.

### Calendar

One calendar inside an account (Work, Personal, Holidays, a shared
read-only).

- `providerCalendarId` unique per account (Google cal id, Graph id,
  CalDAV href)
- `name`, `color` (provider hex, `#rrggbb`)
- `isVisible` (user toggle, default true), `isPrimary`, `isReadOnly`
- `timezone` optional IANA from the provider
- Incremental cursor: `syncToken` (Google syncToken or Graph delta
  link or CalDAV sync-token), `ctag` for CalDAV
- `lastError` optional. One calendar can fail while the rest of the
  account continues.

### CalendarEvent

Master or exception. Not an expanded occurrence.

- `providerEventId` unique per calendar
- `icalUid` for invite matching
- `etag`, `sequence` for write conflicts
- `title`, `description`, `location`
- `startAt` / `endAt` timestamptz
- `isAllDay`, `timezone` (IANA wall-clock zone for timed events)
- `status`: `confirmed` | `tentative` | `cancelled`
- `transparency`: `busy` | `free` (free does not block freetime)
- `rrule`, `exdate` (and `rdate` if the provider has it), stored as
  iCalendar strings
- `masterEventId` + `recurrenceId` set on exceptions
- `organizerJson`, `attendeesJson`
- `rawJson` provider payload for round-trip fields we do not model

All-day events are civil dates. `startAt` is midnight UTC of the first
day. `endAt` is exclusive: midnight UTC of the day after the last day
(iCalendar `DTEND`). `isAllDay` is true. Display must not shift them
by `User.timezone`. A 20 Aug all-day event is 20 Aug in every zone.

Timed events store UTC. Display and create/edit use `User.timezone`
unless the event has its own `timezone`, which wins while editing.

### CalendarEventInstance

Materialized occurrence in the window now-2 months .. now+18 months.

- `eventId`, `calendarId`, `userId`
- `startAt`, `endAt`, `isAllDay`, `isCancelled`, `isException`
- Indexes: `(userId, startAt, endAt)`, `(eventId)`,
  `(userId, calendarId, startAt)`

Rebuild instances for a master when that master or any of its exceptions
change. Pure function `expandEventWindow(master, exceptions, from, to)`
in `src/lib/calendar/expand.ts`. Library: `rrule`.

Rows outside the window are not kept. A range request that falls outside
calls `expandEventWindow` and returns the result without inserting.

### MessageMeeting

Parsed invite attached to one `Message`. Unique on `messageId`.

- `uid`, `method` (`REQUEST` | `CANCEL` | `REPLY` | `PUBLISH` |
  `COUNTER`)
- `title`, `startAt`, `endAt`, `isAllDay`, `location`
- `organizerEmail`, `organizerName`, `recurrenceId`
- `calendarEventId` set after RSVP or UID match

`COUNTER` is stored and shown as an invite, but the thread card does not
offer a counter-propose action.

### CalendarTombstone

Deleted masters so native delta-sync can drop rows it already has.

- `userId`, `eventId` (replica id), `providerEventId`, `deletedAt`
- Unique `(userId, eventId)`. Index `(userId, deletedAt)`.
- Prune after 30 days.

### User / EmailConnection / Message

`User` gains relations to the new models. `EmailConnection` gains
optional `calendarAccounts`. `Message` gains optional `meeting`.

Settings backup (`kurir-settings-backup`) does not include calendar
accounts or events. Tokens and provider data stay out of the dummy Sent
JSON. Explicit: restoring settings does not restore calendars. The user
reconnects them.

## Provider adapters

`src/lib/calendar/providers/types.ts` defines one interface. Three
implementations: `google.ts`, `microsoft.ts`, `caldav.ts`.

```ts
type RecurrenceEdit = "this" | "thisAndFollowing" | "all";

interface CalendarAdapter {
  listCalendars(): Promise<RemoteCalendar[]>;
  pull(calendar: Calendar, cursor: string | null): Promise<PullResult>;
  createEvent(calendar: Calendar, input: EventInput): Promise<RemoteEvent>;
  updateEvent(
    calendar: Calendar,
    event: CalendarEvent,
    input: EventInput,
    range: RecurrenceEdit,
  ): Promise<RemoteEvent>;
  deleteEvent(
    calendar: Calendar,
    event: CalendarEvent,
    range: RecurrenceEdit,
  ): Promise<void>;
  respond(
    calendar: Calendar,
    event: CalendarEvent,
    status: "accepted" | "tentative" | "declined",
  ): Promise<RemoteEvent>;
}
```

`PullResult` is `{ upserts, deletedProviderIds, cursor, reset: boolean }`.
`reset: true` means the cursor is dead (Google 410, Graph gone, CalDAV
sync-token invalid).

Delete-missing is allowed only when the pull is a complete collection
(Google `syncToken` / Graph delta / CalDAV `sync-collection`). A CalDAV
`calendar-query` over the instance window is partial. It may upsert and
it may delete by reported href. It must not delete masters that simply
fall outside the window.

Fetch masters and exceptions, never pre-expanded instances.

- Google: `events.list` with `singleEvents=false`. Incremental
  `syncToken`. Do not use `calendarView`.
- Graph: list events on the calendar, not `calendarView`. Incremental
  delta link.
- CalDAV: `sync-collection` when the server supports it, else
  `calendar-query` over the instance window. Library: `tsdav` +
  `ical.js`.

Libraries:

- `googleapis` (Calendar API v3)
- `@microsoft/microsoft-graph-client`
- `tsdav` + `ical.js`
- `rrule` (expansion only)

OAuth scopes (calendar flow only):

- Google: `openid`, `email`, `https://www.googleapis.com/auth/calendar`
- Microsoft: `openid`, `email`, `offline_access`, `Calendars.ReadWrite`

CalDAV discovery: if the user pastes a host (or `https://caldav.icloud.com`),
the adapter follows `.well-known/caldav` and the current-user principal
to the calendar-home. iCloud uses an app-specific password. Document that
in the CalDAV form help text.

Shared / subscribed calendars the provider lists appear as `isReadOnly`
when the adapter cannot write. They still sync and they still take part
in freetime if `transparency` is busy.

## Sync

New queue `sync-calendar` in `src/lib/jobs/queue.ts`. Repeat every
120 seconds, one job per `CalendarAccount`, jobId stable per account.
Worker in `src/lib/jobs/calendar-sync-worker.ts`.

Lock: set `isSyncing` with a token. If `syncLockAt` is older than 5
minutes, steal the lock. IMAP's lock helpers are the pattern. Do not
share the IMAP lock table.

Per account:

1. Refresh OAuth if needed. On refresh failure set `oauthError` and
   stop that account. Mail tokens are untouched.
2. `listCalendars`. Upsert `Calendar` rows. Calendars that disappeared
   on the provider are marked not visible and stop syncing. Do not
   cascade-delete events on a list miss until a full reset says they
   are gone.
3. For each calendar, `pull`. Upsert masters and exceptions. Delete by
   `providerEventId`. Rebuild instances for touched masters.
4. `lastSyncedAt = now()`, clear account `lastError`. A single calendar
   error is stored on `Calendar.lastError` and the rest of the account
   continues.

`isDemoInstance()`: the worker returns immediately. Seeded rows stay.

Manual "Sync now" from settings enqueues the same job.

## Writes

Server actions and mobile POSTs share `src/lib/calendar/write.ts`.

1. Auth + `userId` ownership. Refuse if `Calendar.isReadOnly`.
2. Optimistic replica update (master / exception / instances).
3. Adapter call with current `etag`.
4. Success: store new `etag` / `providerEventId` / `rawJson`, rebuild
   instances.
5. Failure other than 412: roll the replica back to the pre-write
   snapshot and toast the error.
6. HTTP 412 / etag mismatch: re-pull that event, discard the
   optimistic row, toast `This event changed on Google.` (substitute
   Google / Outlook / this calendar). Do not merge silently.

Moving an event to another calendar on the same account is allowed
(Google `events.move`, Graph change `calendar`, CalDAV PUT+DELETE).
Moving across `CalendarAccount`s is not in v1.

The edit dialog does not add or remove attendees. Organizer and
attendee lists are display-only on the event and on the meeting card.

Recurrence:

- `this`: exception at `recurrenceId`. Google instance patch, Graph
  exception, CalDAV `RECURRENCE-ID`.
- `thisAndFollowing`: split the series at this start. Adapter must
  do the provider-specific split. If the adapter throws, refetch the
  series and do not leave a local-only split.
- `all`: patch the master.

Create on a hidden calendar is allowed and un-hides it. Create on a
read-only calendar is a 403.

Delete of `this` on a series writes an exception / EXDATE, not a
master delete.

## Web UI

Route group `(mail)`, so the existing shell (sidebar, tab bar, session)
wraps it.

| View | Path | Default on |
|------|------|------------|
| Week | `/calendar` | desktop (`md` and up) |
| Day | `/calendar/day` | narrow viewport |
| Month | `/calendar/month` | never the first landing |

All three accept `?date=YYYY-MM-DD`. Missing date is today in
`User.timezone`. Switching views keeps the date.

First landing on a narrow viewport (`md` down) that hits `/calendar`
with no view chosen redirects to `/calendar/day`. Desktop stays on
week. The user can still open Week on a phone via the toggle.

`PageMasthead`:

- Week eyebrow `Calendar`, title the range in Playfair
  (`August 17-23`), meta empty or a quiet calendar count
- Day title `Thursday, August 20`
- Month title `August 2026`

Actions: Today, previous, next, view toggle (Week / Day / Month),
primary `New event`. Depth is the masthead hairline, no shadow on the
grid.

### Visual language (`DESIGN.md` + frontend-taste)

This is a data-dense tool inside an editorial app. Density comes from
removing chrome, not from shrinking type until it fails.

- Inter for hours, event titles, attendees. Playfair only on the
  masthead title and empty-state headline.
- Hours, dates, durations: `tabular-nums`.
- Event chrome: 2px left rail in the calendar color, faint tint fill
  (`color-mix` with `background` so Google neon cannot take over).
  No drop shadow, no rounded-pill time chips, no avatars.
- Now: a 1px terracotta line across today at the current time, small
  time label. The only loud accent on the grid.
- Weekends: `bg-muted/40`, not a second hue.
- Overlaps: columns inside the day, 1px gap.
- Visible hours 07:00-21:00 in `User.timezone`, full 00:00-24:00
  scrollable. All-day row is a compact strip above the times.
- Freetime: an empty span of 2 hours or more, inside 07:00-21:00,
  labeled `Free` in muted Inter. Not a badge, not a card. Events with
  `transparency=free` do not split the span. Night hours get no label.
- No month-grid as home. Month is a real third view: seven-column
  month, event titles as one-line rails, `+N` when a day overflows,
  multi-day as a spanning bar. Click a day goes to `/calendar/day`.
- Calendar colors are meaning (which calendar), not decoration. Do
  not reuse Imbox/Feed/Screener/Paper Trail scales. Clamp stored hex
  via `color-mix`. Dark theme uses the same hex against the dark
  background.

Empty state (no `CalendarAccount`): Playfair `Connect a calendar`,
short Inter sentence, then a list of three actions (Google, Outlook,
CalDAV). Not a hero with three icon cards.

### Calendar list

Desktop: a narrow left column on `/calendar` listing calendars grouped
by account, color dot, name, checkbox for `isVisible`. Hairline, no
card per row.

Narrow viewport: the list lives in a filter sheet from the masthead.

Read-only calendars show a muted `Subscribe` note and disable drop
targets.

### Create and edit

Click or drag on an empty slot opens a dialog (Radix, `shadow-overlay`
is allowed on the dialog). Fields: title, calendar, start, end,
all-day, location, notes, recurrence. Save is the terracotta button.

`n` creates on `/calendar`. Do not steal `c` (compose). `t` jumps to
today. Arrow keys move week/day/month. `g e` navigates to `/calendar`.
Contacts keeps `g c`.

Drag move and resize on web and Mac. iPhone uses a sheet for times,
no drag-resize required.

Recurrence save asks this / this and following / all when the event
is part of a series.

### Navigation

Sidebar: `Calendar` after Paper Trail, before Snoozed. Lucide
`Calendar`. No badge.

PWA tab bar: Calendar is not pinned. It appears in More because it
joins `navigation`. Native iOS gets a top-level Calendar tab. Mac
gets a sidebar item matching web.

Command palette: `Calendar` and `New event`.

Settings: new tab `Calendar` next to Account / Mail / System
(`?tab=calendar`). Lists accounts, last sync, error, reconnect,
disconnect, visibility. `Add Google`, `Add Outlook`, `Add CalDAV`.

## Native contract

The contract is JSON. No shared UI kit.

### Endpoints

All under `/api/mobile/calendar/`, `requireMobileAuth`, `userId`
scoped, rate limited like the other mobile routes.

| Method | Path | Role |
|--------|------|------|
| GET | `/accounts` | accounts + calendars + visibility + errors |
| POST | `/accounts/google` | start OAuth (returns auth URL) |
| POST | `/accounts/microsoft` | start OAuth |
| POST | `/accounts/caldav` | create from URL / username / password |
| DELETE | `/accounts/:id` | disconnect |
| PATCH | `/calendars/:id` | `{ isVisible }` |
| GET | `/sync?cursor=` | delta of accounts, calendars, masters, exceptions, tombstones |
| GET | `/range?start&end&calendarIds?` | instances in range (server-expanded) |
| POST | `/events` | create |
| PATCH | `/events/:id` | update, body includes `range` |
| DELETE | `/events/:id?range=` | delete |
| POST | `/rsvp` | `{ messageId, status, calendarId? }` |

OAuth callback is `GET /api/calendar/oauth/callback` on the server
(web session or a one-time code the native client swaps). Native
opens that flow in `ASWebAuthenticationSession` (Mac: the matching
session API) and returns to the app with the same mobile-auth
callback pattern already used for Google/Microsoft mail. CalDAV is
a form on the device. Do not invent a second OAuth client id.

`GET /range` is the view query. `GET /sync` keeps masters fresh.
Jumping the month view to a date outside the materialised window still
works because range expands on the fly.

Tombstones: `CalendarTombstone` for deleted masters (`providerEventId`
or replica id) so a native client that already synced the master drops
it. Prune after 30 days, same idea as `MessageTombstone`.

### Native UI

Same three modes, same default split (iPhone day, Mac week), same
event chrome rules (rail, no avatars, terracotta now line, `Free`
label). Empty-state copy is the web strings.

iOS navigation title `Calendar`. System Date Picker for jumping, not
a fake masthead. Mac uses the sidebar + a masthead analogue already
used for mail lists.

Create / edit in a sheet. Recurrence range action sheet.

Meeting card on the thread view, same actions as web, calling
`POST /rsvp`.

## Meeting invites

During `processMessage`, if a part is `text/calendar` or a filename
ends in `.ics`, parse with `ical.js` in `src/lib/calendar/ics.ts`.
On failure log and continue. Never throw into IMAP sync.

Write `MessageMeeting`. If `uid` already matches a `CalendarEvent` for
that user, set `calendarEventId`.

Thread UI (web message pane, native thread): a block above the body.

- Title, civil date or timed range in `User.timezone` with
  `tabular-nums`, location, organizer as a name (no avatar)
- `REQUEST`: Accept / Maybe / Decline. Accept is terracotta.
- `CANCEL`: copy `This meeting was cancelled.` No buttons.
- Existing `calendarEventId`: status text plus `Show in calendar`
  linking to `/calendar/day?date=`
- No writable calendar: buttons disabled, copy
  `Connect a calendar to reply.`

RSVP (`src/lib/calendar/rsvp.ts`):

1. Resolve calendar: explicit `calendarId`, else primary writable
   calendar on the `CalendarAccount` whose `principalEmail` matches
   the message's `EmailConnection.email` or aliases, else the user's
   first writable visible calendar.
2. If no event for `uid`, `createEvent` on that calendar from the
   ICS fields, then respond.
3. If `recurrenceId` is set, the RSVP applies to `this`. Otherwise
   `all`.
4. Google and Microsoft: `adapter.respond` only. They send the
   organizer mail. Do not also SMTP an iTIP REPLY.
5. CalDAV and any invite whose event lives on CalDAV: update
   `PARTSTAT` via the adapter and send an iTIP `REPLY` through
   `sendMailForUser` to the organizer, `Content-Type: text/calendar;
   method=REPLY`.
6. Demo: update the replica only. No provider call, no SMTP.

## Errors, privacy, demo

- `oauthError` / CalDAV 401: banner on `/calendar` and a reconnect
  control in settings. Same shape as a mail connection error, but it
  does not set `EmailConnection.oauthError`.
- Rate limit from a provider: backoff inside the worker, no user
  banner unless it still fails on the next two jobs.
- Do not log ICS bodies or event descriptions (they hold meeting
  notes).
- Do not fetch URLs found in location or description.
- All queries filter `userId`.
- Wipe user / wipe mail: calendar rows cascade with the user. A
  mail-only wipe does not drop `CalendarAccount`.
- Demo: every script that seeds the demo user (including
  `scripts/seed-demo-screenshots.ts`) inserts one `CalendarAccount`,
  two calendars, and a handful of events this week including a 3-hour
  freetime gap and one all-day. The calendar worker no-ops. RSVP is
  local.

## Tests

TDD on pure helpers first, then adapters behind mocks, then UI.

| Helper | File | Covers |
|--------|------|--------|
| `expandEventWindow` | `src/__tests__/unit/calendar-expand.test.ts` | daily/weekly RRULE, EXDATE, exception overlay, all-day not zone-shifted, window bounds, free/busy ignored here |
| `parseIcs` | `src/__tests__/unit/calendar-ics.test.ts` | Google REQUEST, Outlook REQUEST, CANCEL, all-day, TZID, recurring + RECURRENCE-ID, garbage input returns null |
| `routeRsvp` | `src/__tests__/unit/calendar-rsvp.test.ts` | Google/Graph => no SMTP, CalDAV => SMTP + adapter, missing UID => create then respond, no writable calendar => error, recurrenceId => this |
| `recurrenceWrite` | `src/__tests__/unit/calendar-recurrence.test.ts` | this / thisAndFollowing / all local transitions, rollback on adapter throw |
| `rangeQuery` | `src/__tests__/unit/calendar-range.test.ts` | overlap, hidden calendars excluded, on-the-fly expand outside window |

Fixture ICS files under `src/__tests__/fixtures/ics/`.

No live Google/Graph/CalDAV in CI. Adapter tests mock HTTP.

Wipe, demo-gate, and mobile auth tests follow the existing
integration patterns when those routes exist.

## Implementation split

After this spec is approved in the file, two plans:

1. `docs/specs/2026-08-20-calendar-plan-server.md` - schema,
   adapters, worker, web UI, mail ICS hook, mobile API, demo seed.
2. `docs/specs/2026-08-20-calendar-plan-ios.md` - native models,
   sync, week/day/month, settings OAuth/CalDAV, thread card. Starts
   after the mobile API in plan 1 exists.

Server plan must ship `GET /range` and `POST /rsvp` before native
work depends on them.

## Out of scope that might look in-scope

- Command palette as a calendar search across years (week navigation
  and the month jumper are enough)
- Weather, maps embed, video-call buttons beyond a location string
- Editing another attendee's event as the organizer's delegate
  beyond what the provider already allows on that calendar
- Color picker beyond the provider color and the visibility toggle
