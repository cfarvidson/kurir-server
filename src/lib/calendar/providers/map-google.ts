import { allDayUtcBounds } from "@/lib/calendar/range";
import type { RemoteEvent } from "./types";

type GoogleDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEvent = {
  id?: string;
  iCalUID?: string;
  etag?: string;
  sequence?: number;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  transparency?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDate;
  organizer?: unknown;
  attendees?: unknown;
};

function asRecord(raw: unknown): GoogleEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("mapGoogleEvent: expected an event object");
  }
  return raw as GoogleEvent;
}

function parseGoogleInstant(slot: GoogleDate | undefined): {
  at: Date;
  isAllDay: boolean;
  timezone: string | null;
} | null {
  if (!slot) return null;
  if (slot.date) {
    const bounds = allDayUtcBounds(slot.date, slot.date);
    return { at: bounds.startAt, isAllDay: true, timezone: null };
  }
  if (slot.dateTime) {
    return {
      at: new Date(slot.dateTime),
      isAllDay: false,
      timezone: slot.timeZone ?? null,
    };
  }
  return null;
}

function mapStatus(
  status: string | undefined,
): RemoteEvent["status"] {
  if (status === "cancelled") return "cancelled";
  if (status === "tentative") return "tentative";
  return "confirmed";
}

function mapTransparency(
  transparency: string | undefined,
): RemoteEvent["transparency"] {
  return transparency === "transparent" ? "free" : "busy";
}

function splitRecurrence(lines: string[] | undefined): {
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
} {
  let rrule: string | null = null;
  let rdate: string | null = null;
  let exdate: string | null = null;
  if (!lines) return { rrule, rdate, exdate };

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith("RRULE:")) {
      rrule = trimmed.slice(trimmed.indexOf(":") + 1);
    } else if (upper.startsWith("RDATE")) {
      rdate = trimmed.includes(":")
        ? trimmed.slice(trimmed.indexOf(":") + 1)
        : trimmed;
    } else if (upper.startsWith("EXDATE")) {
      exdate = trimmed.includes(":")
        ? trimmed.slice(trimmed.indexOf(":") + 1)
        : trimmed;
    }
  }
  return { rrule, rdate, exdate };
}

export function mapGoogleEvent(raw: unknown): RemoteEvent {
  const g = asRecord(raw);
  if (!g.id) {
    throw new Error("mapGoogleEvent: missing id");
  }
  if (!g.start || !g.end) {
    throw new Error("mapGoogleEvent: missing start/end");
  }

  const isAllDay = Boolean(g.start.date);
  let startAt: Date;
  let endAt: Date;
  let timezone: string | null = null;

  if (isAllDay) {
    if (!g.start.date || !g.end.date) {
      throw new Error("mapGoogleEvent: all-day event missing date");
    }
    const bounds = allDayUtcBounds(g.start.date, g.end.date);
    startAt = bounds.startAt;
    endAt = bounds.endAt;
  } else {
    if (!g.start.dateTime || !g.end.dateTime) {
      throw new Error("mapGoogleEvent: timed event missing dateTime");
    }
    startAt = new Date(g.start.dateTime);
    endAt = new Date(g.end.dateTime);
    timezone = g.start.timeZone ?? g.end.timeZone ?? null;
  }

  const recurrenceId = parseGoogleInstant(g.originalStartTime)?.at ?? null;
  const { rrule, rdate, exdate } = splitRecurrence(g.recurrence);

  return {
    providerEventId: g.id,
    icalUid: g.iCalUID ?? null,
    etag: g.etag ?? null,
    sequence: typeof g.sequence === "number" ? g.sequence : 0,
    title: g.summary ?? "",
    description: g.description ?? null,
    location: g.location ?? null,
    startAt,
    endAt,
    isAllDay,
    timezone,
    status: mapStatus(g.status),
    transparency: mapTransparency(g.transparency),
    rrule,
    rdate,
    exdate,
    masterProviderEventId: g.recurringEventId ?? null,
    recurrenceId,
    organizerJson: g.organizer ?? null,
    attendeesJson: g.attendees ?? null,
    rawJson: raw,
  };
}
