import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listCalendarAccountsForUser } from "@/lib/calendar/accounts";
import { normalizeAttendees } from "@/lib/calendar/attendees";
import { serializeRangeInstance } from "@/lib/calendar/mobile";
import type { EventInput } from "@/lib/calendar/providers/types";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import { rsvpToMeetingForUser } from "@/lib/calendar/rsvp";
import {
  addDays,
  allDayRangeUtc,
  zonedParts,
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
// One extra hour so 31 civil days that span a DST fall-back still fit.
const MAX_RANGE_MS = MAX_RANGE_DAYS * 86_400_000 + 3_600_000;

const listEventsSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  calendarId: z.string().min(1).optional(),
});

const WALL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validCivil(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Parse an ISO-8601 datetime. A value with an explicit offset (`Z`,
 * `+02:00`) is an instant. A value without one is wall-clock time in
 * `timeZone`, the same rule the web calendar applies to its own inputs.
 * Impossible dates and times (Feb 30, 25:00) are rejected.
 */
export function parseWhen(value: string, timeZone: string): Date | null {
  const wall = WALL_RE.exec(value.trim());
  if (wall) {
    const year = Number(wall[1]);
    const month = Number(wall[2]);
    const day = Number(wall[3]);
    const hour = Number(wall[4] ?? 0);
    const minute = Number(wall[5] ?? 0);
    const second = Number(wall[6] ?? 0);
    if (!validCivil(year, month, day) || hour > 23 || minute > 59 || second > 59) {
      return null;
    }
    const base = zonedWallToUtc(timeZone, { year, month, day, hour, minute });
    return new Date(base.getTime() + second * 1000);
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function parseCivil(value: string): CivilDate | null {
  const m = CIVIL_RE.exec(value.trim());
  if (!m) return null;
  const civil = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return validCivil(civil.year, civil.month, civil.day) ? civil : null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Wall-clock rendering for confirmation prompts: `2026-09-20 09:00 (Europe/Stockholm)`. */
function formatLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)} (${timeZone})`;
}

function formatCivil(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function userTimezone(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return user?.timezone || "UTC";
}

function revalidateCalendar(): void {
  revalidatePath("/calendar");
  revalidatePath("/calendar/day");
  revalidatePath("/calendar/month");
}

async function listCalendars(ctx: ToolContext): Promise<ToolResult> {
  const accounts = await listCalendarAccountsForUser(ctx.userId);
  return ok({
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      displayName: account.displayName,
      principalEmail: account.principalEmail,
      calendars: account.calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        isPrimary: calendar.isPrimary,
        isVisible: calendar.isVisible,
        isReadOnly: calendar.isReadOnly,
      })),
    })),
  });
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
  return ok({ events: filtered.map(serializeRangeInstance) });
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

function formatCreateSummary(
  calendarName: string,
  input: EventInput,
  timeZone: string,
): string {
  const lines = [`Create event "${input.title}" in calendar ${calendarName}`];
  if (input.isAllDay) {
    const lastDay = new Date(input.endAt.getTime() - 86_400_000);
    lines.push(`All day: ${formatCivil(input.startAt)} to ${formatCivil(lastDay)}`);
  } else {
    lines.push(`From: ${formatLocal(input.startAt, timeZone)}`);
    lines.push(`To: ${formatLocal(input.endAt, timeZone)}`);
  }
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

  const calendar = await db.calendar.findFirst({
    where: { id: parsed.data.calendarId, userId: ctx.userId },
    select: { id: true, name: true, isReadOnly: true },
  });
  if (!calendar) return err("not found or not yours");
  if (calendar.isReadOnly) return err("Calendar is read-only");

  // The timezone decides which instant the user confirms, so it is part of
  // the hashed args: changing it between prompt and accept is a mismatch.
  return requireConfirmation(
    ctx,
    "create_event",
    { ...parsed.data, timeZone },
    formatCreateSummary(calendar.name, input, timeZone),
    async () => {
      const created = await createEventForUser(ctx.userId, calendar.id, input);
      revalidateCalendar();
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
  timeZone: string,
): string {
  const lines = [
    `Delete event "${row.title}" from calendar ${row.calendar.name}`,
    `Starts: ${row.isAllDay ? formatCivil(row.startAt) : formatLocal(row.startAt, timeZone)}`,
  ];
  if (row.rrule) lines.push(`Recurring: ${row.rrule}`);
  lines.push(`Range: ${range}`);
  if (occurrence) lines.push(`Occurrence: ${formatLocal(occurrence, timeZone)}`);
  return lines.join("\n");
}

async function deleteEvent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_CALENDAR_DISABLED);
  const parsed = deleteEventSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const timeZone = await userTimezone(ctx.userId);
  let occurrence: Date | null = null;
  if (parsed.data.occurrence) {
    occurrence = parseWhen(parsed.data.occurrence, timeZone);
    if (!occurrence) return err("occurrence must be an ISO-8601 datetime");
  }
  const row = await getEventForUser(ctx.userId, parsed.data.id);

  return requireConfirmation(
    ctx,
    "delete_event",
    { ...parsed.data, timeZone },
    formatDeleteSummary(row, parsed.data.range, occurrence, timeZone),
    async () => {
      await deleteEventForUser(
        ctx.userId,
        parsed.data.id,
        parsed.data.range,
        occurrence,
      );
      revalidateCalendar();
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
  if (meeting.startAt) {
    const timeZone = await userTimezone(ctx.userId);
    lines.push(`Starts: ${formatLocal(meeting.startAt, timeZone)}`);
  }
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
      revalidateCalendar();
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
    name: "list_calendars",
    description:
      "List the user's calendar accounts and their calendars (id, name, primary, visible, read-only). Use a calendar id from here for create_event.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(listCalendars),
  });

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
      "Create a calendar event in a writable calendar (see list_calendars). Asks the user to confirm before writing. start/end are ISO-8601 datetimes read in the user's timezone unless they carry an offset; end is exclusive. For an all-day event (allDay: true) start and end are dates (YYYY-MM-DD) and end is the last day, inclusive. No attendees.",
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
    annotations: { openWorldHint: true },
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
    annotations: { destructiveHint: true, openWorldHint: true },
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
    annotations: { destructiveHint: true, openWorldHint: true },
    handler: wrap(respondToEvent),
  });
}
