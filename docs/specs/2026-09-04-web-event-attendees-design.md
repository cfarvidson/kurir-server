# Web event attendees - design

Date: 2026-09-04. Status: spike. Do not edit `event-dialog.tsx` until a
follow-on plan. MCP `create_event` attendees stay deferred
(`docs/specs/2026-09-04-mcp-calendar-tools-design.md`).

Users can sync meetings that already have attendees. They cannot invite
anyone from Kurir's editor. `createEventForUser` already persists
`attendeesJson: asJson(input.attendees)` (`src/lib/calendar/write.ts:812`).
`EventInput.attendees` is `EventAttendeeInput[] | null`
(`src/lib/calendar/providers/types.ts:59`). The dialog `Draft`
(`src/components/calendar/event-dialog.tsx:41-53`) has title, calendar,
dates, times, allDay, location, notes, repeat only.

## Provider table

| Provider | Create with attendees sends invitations? | Empty attendee list on update cancels invites? | Evidence |
|----------|------------------------------------------|------------------------------------------------|----------|
| Google | Unknown / likely no until we set `sendUpdates`. `events.insert` does not pass `sendUpdates`. | No. `toGoogleEvent` only sets `body.attendees` when `length > 0`, so `[]` omits the field and leaves remote attendees. | `src/lib/calendar/providers/google.ts:108-115`, create at `:362-370` |
| Microsoft | Yes (typical Graph POST `/events` with `attendees`). Code maps attendees onto the body; no `sendInvitations` override. | Unknown / likely no. Same `length > 0` guard; omitted field does not PATCH attendees to empty. | `src/lib/calendar/providers/microsoft.ts:310-328` |
| CalDAV | No. Writes `ATTENDEE` on the VEVENT PUT. No iTIP REQUEST in-tree. | No scheduling cancel. Empty input skips the loop; existing ATTENDEE lines are whatever `applyInput` rebuilds. | `src/lib/calendar/providers/caldav.ts:418-430` `applyInvitees` |
| ICS | N/A. Writes refused. | N/A | `src/lib/calendar/providers/ics.ts:120-125` `refuseWrite` |

iTIP exists for RSVP replies only (`src/lib/calendar/itip.ts`
`sendItipReply`, used from `rsvp.ts` when `rsvpSendsItip` is CalDAV).
There is no iTIP REQUEST for new invites.

Follow-on for Google: if v1 promises "sends invite", pass
`sendUpdates: "all"` on insert/patch. Until then the UI copy must not
say Google will email guests.

## UI proposal

- Chip input on create/edit for writable calendars only (email + optional
  name). Reuse chip radius (`radius-xs` in DESIGN.md) and
  `text-muted-foreground` meta. One terracotta `bg-primary` submit. No
  avatar circles (DESIGN.md / no-avatars).
- Show existing attendees + PARTSTAT on edit via
  `normalizeAttendees` / `CalendarAttendeeDTO`
  (`src/lib/calendar/attendees.ts:14-18`, `:81`).
- Hide the field when `calendar.isReadOnly` (`assertWritable` already
  403s writes at `write.ts:190`; ICS is read-only).
- Own-address: `CalendarAttendeeDTO.isSelf` plus
  `getOwnAddresses` / `isOwnAddress` for the chip that is the user.
- Validation: zod `z.array(z.string().email())`, same as MCP send
  `addressList` (`src/lib/mcp/tools/send.ts:25`). Map to
  `EventAttendeeInput` `{ email, name?, status: "needsAction" }`.
- Empty state: no "Add rooms", no Google-only features.

Compose already has attachment chips (`attachment-chips.tsx`). Prefer
that chip treatment over a new people-picker. `cmdk` is the command
palette, not a recipient widget.

## v1 cut

- Ship invite chips on **Google and Microsoft** writable calendars.
  Copy: Google does not email guests until `sendUpdates` is wired;
  Microsoft likely does.
- **CalDAV**: display-only (show synced ATTENDEE + PARTSTAT, no add).
  Adding would write local ATTENDEE with no scheduling.
- **ICS**: hidden (`refuseWrite`).

Out of v1: iOS/macOS editor, custom recurrence authoring, MCP
`create_event` attendees, notify-attendees flags, removing an attendee
as a dedicated "uninvite" that PATCHes an empty list (today `[]` does
not clear).

## Open questions

- Should Google v1 wait for `sendUpdates: "all"`, or ship the chip with
  honest "saved on the event, may not email" copy?
- Removing an attendee: needs an adapter change so empty-or-missing
  means "clear", not "omit".
- Optional vs required: Graph maps `type: "required"` only
  (`microsoft.ts:312`). Google has no optional flag in `toGoogleEvent`.
  v1 is required-only.

## Follow-on tests

Attendee round-trip in `calendar-write.test.ts`. Dialog tests only if
the repo already tests `event-dialog` (it does not today).
