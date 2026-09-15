import { z } from "zod";
import { normalizeAttendees } from "@/lib/calendar/attendees";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import type { VisibleInstance } from "@/lib/calendar/query";
import { rsvpToMeetingForUser } from "@/lib/calendar/rsvp";
import type { EventInput } from "@/lib/calendar/providers/types";
import {
  addDays,
  allDayRangeUtc,
  zonedWallToUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";
import {
  createEventForUser,
  deleteEventForUser,
  getEventForUser,
} from "@/lib/calendar/write";
import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import {
  err,
  firstZodMessage,
  ok,
  requireConfirmation,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

export const DEMO_CALENDAR_DISABLED =
  "Calendar changes are disabled on this demo instance.";

const MAX_RANGE_DAYS = 31;
const MAX_RANGE_MS = MAX_RANGE_DAYS * 86_400_000;

const listEventsSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  calendarId: z.string().min(1).optional(),
});

const WALL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/**
 * Parse an ISO-8601 datetime. A value with an explicit offset (`Z`,
 * `+02:00`) is an instant. A value without one is wall-clock time in
 * `timeZone`, the same rule the web calendar applies to its own inputs.
 */
export function parseWhen(value: string, timeZone: string): Date | null {
  const wall = WALL_RE.exec(value.trim());
  if (wall) {
    const [, year, month, day, hour, minute] = wall;
    return zonedWallToUtc(timeZone, {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour ?? 0),
      minute: Number(minute ?? 0),
    });
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

async function userTimezone(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return user?.timezone || "UTC";
}

function serializeInstance(row: VisibleInstance) {
  return {
    eventId: row.eventId,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isAllDay: row.isAllDay,
    isCancelled: row.isCancelled,
    isException: row.isException,
    transparency: row.transparency,
    location: row.location,
    description: row.description,
    rrule: row.rrule,
    isReadOnly: row.isReadOnly,
    attendees: normalizeAttendees(row.attendeesJson),
  };
}

const getEventSchema = z.object({ id: z.string().min(1) });

function organizerOf(json: unknown): { email: string; name: string | null } | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const rec = json as Record<string, unknown>;
  if (typeof rec.email !== "string") return null;
  return {
    email: rec.email,
    name: typeof rec.name === "string" ? rec.name : null,
  };
}

function serializeEvent(row: Awaited<ReturnType<typeof getEventForUser>>) {
  return {
    id: row.id,
    calendarId: row.calendarId,
    calendarName: row.calendar.name,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    rrule: row.rrule,
    location: row.location,
    description: row.description,
    status: row.status,
    transparency: row.transparency,
    isReadOnly: row.calendar.isReadOnly,
    masterEventId: row.masterEventId,
    recurrenceId: row.recurrenceId?.toISOString() ?? null,
    organizer: organizerOf(row.organizerJson),
    attendees: normalizeAttendees(row.attendeesJson),
  };
}

async function getEvent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getEventSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const row = await getEventForUser(ctx.userId, parsed.data.id);
  return ok(serializeEvent(row));
}

async function listEvents(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = listEventsSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const timeZone = await userTimezone(ctx.userId);
  const from = parseWhen(parsed.data.start, timeZone);
  const to = parseWhen(parsed.data.end, timeZone);
  if (!from || !to) return err("start and end must be ISO-8601 datetimes");
  if (to.getTime() <= from.getTime()) return err("end must be after start");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return err(`Range must be at most ${MAX_RANGE_DAYS} days`);
  }

  const rows = await listVisibleInstancesForUser(ctx.userId, from, to);
  const filtered = parsed.data.calendarId
    ? rows.filter((row) => row.calendarId === parsed.data.calendarId)
    : rows;
  return ok({ events: filtered.map(serializeInstance) });
}

const createEventSchema = z.object({
  calendarId: z.string().min(1),
  title: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseCivil(value: string): CivilDate | null {
  const m = CIVIL_RE.exec(value.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Turn tool args into the core's EventInput. Timed events are wall-clock
 * in the user's zone (unless the value carries an offset). All-day events
 * are civil dates stored at UTC midnight, end day inclusive, the same
 * shape the web dialog produces.
 */
function toEventInput(
  data: z.infer<typeof createEventSchema>,
  timeZone: string,
): EventInput | string {
  let startAt: Date;
  let endAt: Date;
  if (data.allDay) {
    const startDay = parseCivil(data.start);
    const endDay = parseCivil(data.end);
    if (!startDay || !endDay) {
      return "start and end must be dates (YYYY-MM-DD) for an all-day event";
    }
    const range = allDayRangeUtc(startDay, addDays(endDay, 1));
    if (range.endAt.getTime() <= range.startAt.getTime()) {
      return "end must not be before start";
    }
    startAt = range.startAt;
    endAt = range.endAt;
  } else {
    const from = parseWhen(data.start, timeZone);
    const to = parseWhen(data.end, timeZone);
    if (!from || !to) return "start and end must be ISO-8601 datetimes";
    if (to.getTime() <= from.getTime()) return "end must be after start";
    startAt = from;
    endAt = to;
  }
  return {
    title: data.title,
    description: data.notes?.trim() || null,
    location: data.location?.trim() || null,
    startAt,
    endAt,
    isAllDay: Boolean(data.allDay),
    timezone: data.allDay ? null : timeZone,
    rrule: null,
  };
}

function formatCreateSummary(calendarId: string, input: EventInput): string {
  const lines = [
    `Create event "${input.title}" in calendar ${calendarId}`,
    input.isAllDay
      ? `All day: ${input.startAt.toISOString().slice(0, 10)} to ${new Date(
          input.endAt.getTime() - 86_400_000,
        )
          .toISOString()
          .slice(0, 10)}`
      : `From: ${input.startAt.toISOString()}\nTo: ${input.endAt.toISOString()}`,
  ];
  if (input.location) lines.push(`Location: ${input.location}`);
  if (input.description) lines.push(`Notes: ${input.description}`);
  return lines.join("\n");
}

async function createEvent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_CALENDAR_DISABLED);
  const parsed = createEventSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const timeZone = await userTimezone(ctx.userId);
  const input = toEventInput(parsed.data, timeZone);
  if (typeof input === "string") return err(input);

  return requireConfirmation(
    ctx,
    "create_event",
    parsed.data,
    formatCreateSummary(parsed.data.calendarId, input),
    async () => {
      const created = await createEventForUser(
        ctx.userId,
        parsed.data.calendarId,
        input,
      );
      return ok({ id: created.id });
    },
  );
}

const RANGES = ["all", "this", "thisAndFollowing"] as const;

const deleteEventSchema = z
  .object({
    id: z.string().min(1),
    range: z.enum(RANGES).default("all"),
    occurrence: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.range !== "all" && !value.occurrence) {
      ctx.addIssue({
        code: "custom",
        path: ["occurrence"],
        message:
          "occurrence (the startAt of the occurrence from list_events) is required for range this / thisAndFollowing",
      });
    }
  });

function formatDeleteSummary(
  row: Awaited<ReturnType<typeof getEventForUser>>,
  range: (typeof RANGES)[number],
  occurrence: Date | null,
): string {
  const lines = [
    `Delete event "${row.title}" from calendar ${row.calendar.name}`,
    `Starts: ${row.startAt.toISOString()}`,
  ];
  if (row.rrule) lines.push(`Recurring: ${row.rrule}`);
  lines.push(`Range: ${range}`);
  if (occurrence) lines.push(`Occurrence: ${occurrence.toISOString()}`);
  return lines.join("\n");
}

async function deleteEvent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_CALENDAR_DISABLED);
  const parsed = deleteEventSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  let occurrence: Date | null = null;
  if (parsed.data.occurrence) {
    occurrence = new Date(parsed.data.occurrence);
    if (Number.isNaN(occurrence.getTime())) {
      return err("occurrence must be an ISO-8601 datetime");
    }
  }
  const row = await getEventForUser(ctx.userId, parsed.data.id);

  return requireConfirmation(
    ctx,
    "delete_event",
    parsed.data,
    formatDeleteSummary(row, parsed.data.range, occurrence),
    async () => {
      await deleteEventForUser(
        ctx.userId,
        parsed.data.id,
        parsed.data.range,
        occurrence,
      );
      return ok({ ok: true, id: parsed.data.id });
    },
  );
}

const RSVP_STATUSES = ["accepted", "tentative", "declined"] as const;

const respondToEventSchema = z.object({
  messageId: z.string().min(1),
  status: z.enum(RSVP_STATUSES),
  calendarId: z.string().min(1).optional(),
});

async function respondToEvent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_CALENDAR_DISABLED);
  const parsed = respondToEventSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const meeting = await db.messageMeeting.findFirst({
    where: { userId: ctx.userId, messageId: parsed.data.messageId },
    select: { title: true, startAt: true, organizerEmail: true },
  });
  if (!meeting) return err("not found or not yours");

  const lines = [
    `Reply "${parsed.data.status}" to invitation "${meeting.title}"`,
  ];
  if (meeting.startAt) lines.push(`Starts: ${meeting.startAt.toISOString()}`);
  if (meeting.organizerEmail) lines.push(`Organizer: ${meeting.organizerEmail}`);
  if (parsed.data.calendarId) {
    lines.push(`Add to calendar: ${parsed.data.calendarId}`);
  }

  return requireConfirmation(
    ctx,
    "respond_to_event",
    parsed.data,
    lines.join("\n"),
    async () => {
      await rsvpToMeetingForUser(
        ctx.userId,
        parsed.data.messageId,
        parsed.data.status,
        parsed.data.calendarId,
      );
      return ok({
        ok: true,
        messageId: parsed.data.messageId,
        status: parsed.data.status,
      });
    },
  );
}

export function registerCalendarTools(
  registerTool: (def: ToolDef) => void,
): void {
  registerTool({
    name: "list_events",
    description:
      "List calendar events between start and end (ISO-8601; a value without an offset is read in the user's timezone). At most 31 days. Recurring events are expanded into occurrences. Optional calendarId filters to one calendar.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", description: "ISO-8601 datetime" },
        end: { type: "string", description: "ISO-8601 datetime, exclusive" },
        calendarId: { type: "string" },
      },
      required: ["start", "end"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(listEvents),
  });

  registerTool({
    name: "get_event",
    description:
      "Fetch one calendar event by its id (the eventId from list_events): times, recurrence rule, location, notes, organizer and attendees.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getEvent),
  });

  registerTool({
    name: "create_event",
    description:
      "Create a calendar event. Asks the user to confirm before writing. start/end are ISO-8601 datetimes read in the user's timezone unless they carry an offset; end is exclusive. For an all-day event (allDay: true) start and end are dates (YYYY-MM-DD) and end is the last day, inclusive. No attendees.",
    inputSchema: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        title: { type: "string" },
        start: { type: "string", description: "ISO-8601 datetime or date" },
        end: { type: "string", description: "ISO-8601 datetime or date" },
        allDay: { type: "boolean" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["calendarId", "title", "start", "end"],
    },
    handler: wrap(createEvent),
  });

  registerTool({
    name: "delete_event",
    description:
      "Delete a calendar event. Asks the user to confirm before writing. range defaults to all (the whole event or series); this / thisAndFollowing need occurrence, the startAt of the occurrence as returned by list_events.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        range: { type: "string", enum: [...RANGES] },
        occurrence: { type: "string", description: "ISO-8601 datetime" },
      },
      required: ["id"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(deleteEvent),
  });

  registerTool({
    name: "respond_to_event",
    description:
      "Reply to a calendar invitation that arrived by mail (accepted, tentative or declined). Asks the user to confirm before sending the reply to the organizer. messageId is the id of the mail carrying the invitation; optional calendarId picks which calendar to add it to.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        status: { type: "string", enum: [...RSVP_STATUSES] },
        calendarId: { type: "string" },
      },
      required: ["messageId", "status"],
    },
    handler: wrap(respondToEvent),
  });
}
