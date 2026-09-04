# MCP calendar tools - design

Date: 2026-09-04. Status: spike. Do not register tools until a follow-on
plan. Attendees on create are deferred to
`docs/specs/2026-09-04-web-event-attendees-design.md`.

Calendar is a first-class nav item. MCP at `/mcp` can already read and
send mail. `src/lib/mcp/tools/index.ts:22-26` registers mail, send,
screener, contacts, and settings only. Agents that triage mail on this
instance cannot list or RSVP events.

This spike wraps existing cores. No new Prisma models. No parallel REST
API. Implementation belongs in `src/lib/mcp/tools/calendar.ts` plus one
`registerCalendarTools(registerTool)` line in `index.ts`.

## Inventory (existing functions)

| Need | Function | Evidence |
|------|----------|----------|
| List in a time range | `listVisibleInstancesForUser(userId, from, to, now?)` | `src/lib/calendar/query.ts:349` |
| Get one event | `loadEvent(userId, eventId)` (module-private today) | `src/lib/calendar/write.ts:481` (`where: { id: eventId, userId }`) |
| Create | `createEventForUser(userId, calendarId, input)` | `src/lib/calendar/write.ts:820` |
| Update | `updateEventForUser(userId, eventId, input, range, occurrence?)` | `src/lib/calendar/write.ts:872` |
| Delete | `deleteEventForUser(userId, eventId, range, occurrence?)` | `src/lib/calendar/write.ts:1069` |
| RSVP | `rsvpToMeetingForUser(userId, messageId, status, calendarId?)` | `src/lib/calendar/rsvp.ts:315` (mail meeting row, then `adapter.respond` at `:414`) |

`loadEvent` is not exported. Follow-on exports it (or a thin
`getEventForUser`) without changing the query. Do not add a raw Prisma
path in the tool.

Timezone: `User.timezone`, same fallback as web
(`src/app/api/calendar/instances/route.ts:23-26`, `user?.timezone || "UTC"`).
ISO start/end in tool args are interpreted in that zone, then passed as
`Date` to `listVisibleInstancesForUser`.

Writable check already lives in `assertWritable`
(`src/lib/calendar/write.ts:190`). ICS calendars refuse writes
(`src/lib/calendar/providers/ics.ts:120-125`).

Demo: `createEventForUser` already no-ops the provider on
`isDemoInstance()` (`write.ts:851`). Match send tools and also refuse
create/delete/RSVP at the tool layer with `DEMO_SEND_DISABLED` /
equivalent so agents get a clear error.

## v1 tools

Copy the confirmation pattern from `registerSendTools`
(`src/lib/mcp/tools/send.ts:142` `requireConfirmation` via
`src/lib/mcp/tools/helpers.ts:55`). Handles are 10 minutes, single-use,
hashed args (`src/lib/mcp/confirmations.ts`). Destructive tools set
`annotations: { destructiveHint: true }`.

| Tool | Confirm? | Args | Core |
|------|----------|------|------|
| `list_events` | no | `start`, `end` ISO; optional `calendarId` | `listVisibleInstancesForUser`. Filter by `calendarId` in the tool if set. |
| `get_event` | no | `id` | exported `loadEvent` / `getEventForUser` |
| `create_event` | **yes** | `calendarId`, `title`, `start`, `end`, `allDay`, `location`, `notes` | `createEventForUser`. No attendees in v1. |
| `respond_to_event` | **yes** | `messageId`, `status` (`accepted` / `tentative` / `declined`), optional `calendarId` | `rsvpToMeetingForUser`. The public core is keyed on the mail meeting, not the calendar event id. |
| `delete_event` | **yes** | `id`, optional `range` default `"all"` | `deleteEventForUser` |

Out of v1: update/edit (recurrence `this` / `thisAndFollowing` is v2),
move between calendars, ICS subscribe, CalDAV password, OAuth connect,
attendees on create.

`update_event` exists as a core (`updateEventForUser`) but is out of v1
because recurrence edit modes are easy to get wrong. Agents can delete +
create if they must.

## Confirmation hashing

`createConfirmation` hashes the whole args object. `create_event` args
must include `calendarId`, `start`, and `end` so a swapped time cannot
reuse a handle. `delete_event` args must include `id` and `range`.
`respond_to_event` args must include `messageId` and `status`.

## Threat notes

- Every load already filters `userId` (`loadEvent`,
  `listVisibleInstancesForUser`, `rsvpToMeetingForUser`).
- Confirmation args hash must include calendarId + start/end (create)
  and id (delete). Same idea as send hashing the body.
- Do not return other users' events. Wrap with the existing `wrap()`
  helper so "not found" becomes "not found or not yours"
  (`helpers.ts:28`).
- Demo instance: disable writes the way `send_mail` does
  (`send.ts:135` `isDemoInstance()`).

## Follow-on tests

Mirror `src/__tests__/unit/mcp-tools-send.test.ts`: confirmation required
on create/delete/RSVP, demo short-circuit, `userId` isolation.
