import type { IcsMethod } from "@/lib/calendar/ics";
import {
  civilFromAllDayUtc,
  civilFromZoned,
  formatDateParam,
  formatDayTitle,
  formatTimeLabel,
  zonedParts,
} from "@/lib/calendar/view-time";

export type MeetingRsvpResponse = "accepted" | "tentative" | "declined";

export type MeetingCardMeeting = {
  method: IcsMethod;
  title: string;
  startAt: string | null;
  endAt: string | null;
  isAllDay: boolean;
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  calendarEventId: string | null;
  response: MeetingRsvpResponse | null;
};

const ICS_METHODS = new Set<IcsMethod>([
  "REQUEST",
  "CANCEL",
  "REPLY",
  "PUBLISH",
  "COUNTER",
]);

const PARTSTAT: Record<string, MeetingRsvpResponse> = {
  ACCEPTED: "accepted",
  TENTATIVE: "tentative",
  DECLINED: "declined",
  accepted: "accepted",
  tentative: "tentative",
  declined: "declined",
};

export function meetingCardState(
  method: IcsMethod,
  hasWritableCalendar: boolean,
  response: MeetingRsvpResponse | null,
): {
  showButtons: boolean;
  cancelled: boolean;
  disabledReason: string | null;
} {
  if (method === "CANCEL") {
    return { showButtons: false, cancelled: true, disabledReason: null };
  }
  if (method === "REQUEST") {
    if (hasWritableCalendar) {
      return { showButtons: true, cancelled: false, disabledReason: null };
    }
    return {
      showButtons: false,
      cancelled: false,
      disabledReason: "Connect a calendar to reply.",
    };
  }
  return { showButtons: false, cancelled: false, disabledReason: null };
}

export function meetingDayHref(
  startAt: string | Date | null,
  isAllDay: boolean,
  timezone: string,
): string | null {
  const date = parseInstant(startAt);
  if (!date) return null;
  const civil = isAllDay
    ? civilFromAllDayUtc(date)
    : civilFromZoned(date, timezone);
  return `/calendar/day?date=${formatDateParam(civil)}`;
}

export function meetingOrganizerLabel(
  organizerName: string | null,
  organizerEmail: string | null,
): string | null {
  const name = organizerName?.trim();
  if (name) return name;
  const email = organizerEmail?.trim();
  return email || null;
}

export function meetingWhenLabel(
  startAt: string | Date | null,
  endAt: string | Date | null,
  isAllDay: boolean,
  timezone: string,
): string | null {
  const start = parseInstant(startAt);
  if (!start) return null;
  if (isAllDay) {
    return formatDayTitle(civilFromAllDayUtc(start));
  }
  const startWall = zonedParts(start, timezone);
  const startCivil = {
    year: startWall.year,
    month: startWall.month,
    day: startWall.day,
  };
  const startTime = formatTimeLabel(startWall.hour, startWall.minute);
  const end = parseInstant(endAt);
  if (!end) return `${formatDayTitle(startCivil)} ${startTime}`;
  const endWall = zonedParts(end, timezone);
  const endTime = formatTimeLabel(endWall.hour, endWall.minute);
  if (
    endWall.year === startWall.year &&
    endWall.month === startWall.month &&
    endWall.day === startWall.day
  ) {
    return `${formatDayTitle(startCivil)} ${startTime}-${endTime}`;
  }
  const endCivil = {
    year: endWall.year,
    month: endWall.month,
    day: endWall.day,
  };
  return `${formatDayTitle(startCivil)} ${startTime} - ${formatDayTitle(endCivil)} ${endTime}`;
}

export function meetingResponseFromAttendees(
  attendeesJson: unknown,
): MeetingRsvpResponse | null {
  if (!Array.isArray(attendeesJson)) return null;
  const rows = attendeesJson.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object",
  );
  const self = rows.find((row) => row.self === true);
  const chosen = self ?? (rows.length === 1 ? rows[0] : undefined);
  if (!chosen) return null;
  return statusOf(chosen);
}

export function serializeMessageMeeting(row: {
  method: string;
  title: string;
  startAt: Date | string | null;
  endAt: Date | string | null;
  isAllDay: boolean;
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  calendarEventId: string | null;
  calendarEvent?: { attendeesJson: unknown } | null;
} | null | undefined): MeetingCardMeeting | null {
  if (!row) return null;
  return {
    method: asIcsMethod(row.method),
    title: row.title,
    startAt: toIso(row.startAt),
    endAt: toIso(row.endAt),
    isAllDay: row.isAllDay,
    location: row.location,
    organizerName: row.organizerName,
    organizerEmail: row.organizerEmail,
    calendarEventId: row.calendarEventId,
    response: meetingResponseFromAttendees(row.calendarEvent?.attendeesJson),
  };
}

function asIcsMethod(raw: string): IcsMethod {
  const upper = raw.toUpperCase();
  if (ICS_METHODS.has(upper as IcsMethod)) return upper as IcsMethod;
  return "PUBLISH";
}

function statusOf(row: Record<string, unknown>): MeetingRsvpResponse | null {
  const partstat = row.partstat ?? row.responseStatus;
  if (typeof partstat === "string") {
    return PARTSTAT[partstat] ?? PARTSTAT[partstat.toUpperCase()] ?? null;
  }
  const nested = row.status;
  if (nested && typeof nested === "object" && "response" in nested) {
    const value = (nested as { response: unknown }).response;
    if (typeof value === "string") {
      return PARTSTAT[value] ?? PARTSTAT[value.toUpperCase()] ?? null;
    }
  }
  return null;
}

function parseInstant(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIso(value: Date | string | null): string | null {
  const date = parseInstant(value);
  return date ? date.toISOString() : null;
}
