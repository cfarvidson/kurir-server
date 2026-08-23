import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { normalizeEventHex } from "@/lib/calendar/color";
import { normalizeAttendees } from "@/lib/calendar/attendees";
import {
  CalendarConflictError,
  type RecurrenceEdit,
} from "@/lib/calendar/providers/types";
import { CalendarWriteError } from "@/lib/calendar/write";
import type { VisibleInstance } from "@/lib/calendar/query";
import type { listCalendarAccountsForUser } from "@/lib/calendar/accounts";

export async function requireCalendarMobileAuth(
  req: NextRequest,
): Promise<
  { userId: string; error?: never } | { userId?: never; error: NextResponse }
> {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const limit = await rateLimitUser(mobileAuth.userId);
  if (!limit.allowed) return { error: tooManyRequests(limit.retryAfter) };
  return { userId: mobileAuth.userId };
}

export async function readJsonBody(
  req: NextRequest,
): Promise<{ data: unknown } | { error: NextResponse }> {
  try {
    return { data: await req.json() };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      ),
    };
  }
}

export function invalidRequest(error = "Invalid request"): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

export function calendarRouteError(err: unknown): NextResponse {
  if (err instanceof CalendarWriteError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof CalendarConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  const message = err instanceof Error ? err.message : "Request failed";
  if (
    message === "Calendar account not found" ||
    message === "Calendar not found" ||
    message === "Meeting not found" ||
    message === "Event not found"
  ) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}

const nullableString = z.string().nullable().optional().default(null);

export const eventInputSchema = z.object({
  title: z.string().min(1),
  description: nullableString,
  location: nullableString,
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  isAllDay: z.boolean(),
  timezone: nullableString,
  rrule: nullableString,
});

export const createEventBodySchema = eventInputSchema.extend({
  calendarId: z.string().min(1),
});

export const recurrenceRangeSchema = z.enum([
  "this",
  "thisAndFollowing",
  "all",
]);

export const updateEventBodySchema = eventInputSchema.extend({
  calendarId: z.string().min(1).optional(),
  range: recurrenceRangeSchema,
  // Which occurrence `this` and `thisAndFollowing` mean. Absent from an
  // older client, and from the web, which both get the historical
  // fallback to the series start.
  occurrence: z.coerce.date().nullable().optional().default(null),
});

export const caldavBodySchema = z.object({
  url: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const visibilityBodySchema = z.object({
  isVisible: z.boolean(),
});

export const rsvpBodySchema = z.object({
  messageId: z.string().min(1),
  status: z.enum(["accepted", "tentative", "declined"]),
  calendarId: z.string().min(1).optional(),
});

export function parseRecurrenceRange(
  raw: string | null,
): RecurrenceEdit | null {
  const parsed = recurrenceRangeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseOccurrence(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseIsoRange(
  startRaw: string | null,
  endRaw: string | null,
): { start: Date; end: Date } | null {
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() >= end.getTime()) return null;
  return { start, end };
}

export function parseCalendarIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

type AccountRow = Awaited<ReturnType<typeof listCalendarAccountsForUser>>[number];

export function serializeCalendarAccount(row: AccountRow) {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    principalEmail: row.principalEmail,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    oauthError: row.oauthError,
    calendars: row.calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: normalizeEventHex(calendar.color),
      isVisible: calendar.isVisible,
      isPrimary: calendar.isPrimary,
      isReadOnly: calendar.isReadOnly,
    })),
  };
}

export function serializeRangeInstance(row: VisibleInstance) {
  return {
    id: `${row.eventId}_${row.startAt.toISOString()}`,
    eventId: row.eventId,
    calendarId: row.calendarId,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isAllDay: row.isAllDay,
    isCancelled: row.isCancelled,
    isException: row.isException,
    color: row.color,
    calendarName: row.calendarName,
    transparency: row.transparency,
    location: row.location,
    description: row.description,
    rrule: row.rrule,
    isReadOnly: row.isReadOnly,
    attendees: normalizeAttendees(row.attendeesJson),
  };
}

export function serializeSyncEvent(row: {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  status: string;
  transparency: string;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  icalUid: string | null;
  masterEventId: string | null;
  recurrenceId: Date | null;
  updatedAt: Date;
  sequence: number;
  attendeesJson: unknown;
}) {
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    status: row.status,
    transparency: row.transparency,
    rrule: row.rrule,
    rdate: row.rdate,
    exdate: row.exdate,
    icalUid: row.icalUid,
    masterEventId: row.masterEventId,
    recurrenceId: row.recurrenceId ? row.recurrenceId.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    sequence: row.sequence,
    attendees: normalizeAttendees(row.attendeesJson),
  };
}

export function parseSyncCursor(
  raw: string | null,
): { at: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("_");
  if (sep === -1) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime())) return null;
  return { at, id };
}

export function formatSyncCursor(at: Date, id: string): string {
  return `${at.toISOString()}_${id}`;
}
