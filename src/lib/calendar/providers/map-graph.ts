import { allDayUtcBounds } from "@/lib/calendar/range";
import type { RemoteEvent } from "./types";

type GraphDateTime = {
  dateTime?: string;
  timeZone?: string;
};

type GraphRecurrencePattern = {
  type?: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  firstDayOfWeek?: string;
  index?: string;
};

type GraphRecurrenceRange = {
  type?: string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
};

type GraphEvent = {
  id?: string;
  iCalUId?: string;
  "@odata.etag"?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string } | null;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  seriesMasterId?: string | null;
  type?: string;
  originalStart?: string;
  recurrence?: {
    pattern?: GraphRecurrencePattern;
    range?: GraphRecurrenceRange;
  } | null;
  organizer?: unknown;
  attendees?: unknown;
};

const WEEKDAY: Record<string, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};

function asRecord(raw: unknown): GraphEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("mapGraphEvent: expected an event object");
  }
  return raw as GraphEvent;
}

function datePart(dateTime: string): string {
  return dateTime.slice(0, 10);
}

function parseGraphDateTime(
  slot: GraphDateTime | undefined,
): Date {
  if (!slot?.dateTime) {
    throw new Error("mapGraphEvent: missing dateTime");
  }
  const raw = slot.dateTime.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(raw);
  }
  // Adapters should prefer UTC; treat zone-less payloads as UTC.
  const trimmedFrac = raw.replace(/(\.\d{3})\d+/, "$1");
  return new Date(`${trimmedFrac}Z`);
}

function mapStatus(g: GraphEvent): RemoteEvent["status"] {
  if (g.isCancelled) return "cancelled";
  if (g.showAs === "tentative") return "tentative";
  return "confirmed";
}

function mapTransparency(showAs: string | undefined): RemoteEvent["transparency"] {
  return showAs === "free" ? "free" : "busy";
}

function descriptionOf(g: GraphEvent): string | null {
  const content = g.body?.content?.trim();
  if (content) return content;
  const preview = g.bodyPreview?.trim();
  return preview || null;
}

function untilStamp(endDate: string): string {
  // Graph endDate is YYYY-MM-DD; RRULE UNTIL for all-day-ish use compact UTC day.
  const compact = endDate.replace(/-/g, "");
  return `${compact}T235959Z`;
}

function graphRecurrenceToRrule(
  recurrence: GraphEvent["recurrence"],
): string | null {
  const pattern = recurrence?.pattern;
  const range = recurrence?.range;
  if (!pattern?.type) return null;

  const parts: string[] = [];
  switch (pattern.type) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY");
      break;
    case "absoluteMonthly":
    case "relativeMonthly":
      parts.push("FREQ=MONTHLY");
      break;
    case "absoluteYearly":
    case "relativeYearly":
      parts.push("FREQ=YEARLY");
      break;
    default:
      return null;
  }

  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  if (pattern.daysOfWeek?.length) {
    const days = pattern.daysOfWeek
      .map((d) => WEEKDAY[d.toLowerCase()] ?? null)
      .filter((d): d is string => Boolean(d));
    if (days.length) parts.push(`BYDAY=${days.join(",")}`);
  }

  if (
    (pattern.type === "absoluteMonthly" || pattern.type === "absoluteYearly") &&
    pattern.dayOfMonth
  ) {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }

  if (
    (pattern.type === "absoluteYearly" || pattern.type === "relativeYearly") &&
    pattern.month
  ) {
    parts.push(`BYMONTH=${pattern.month}`);
  }

  if (range?.type === "endDate" && range.endDate) {
    parts.push(`UNTIL=${untilStamp(range.endDate)}`);
  } else if (range?.type === "numbered" && range.numberOfOccurrences) {
    parts.push(`COUNT=${range.numberOfOccurrences}`);
  }

  return parts.join(";");
}

export function mapGraphEvent(raw: unknown): RemoteEvent {
  const g = asRecord(raw);
  if (!g.id) {
    throw new Error("mapGraphEvent: missing id");
  }
  if (!g.start?.dateTime || !g.end?.dateTime) {
    throw new Error("mapGraphEvent: missing start/end dateTime");
  }

  const isAllDay = Boolean(g.isAllDay);
  let startAt: Date;
  let endAt: Date;
  let timezone: string | null = null;

  if (isAllDay) {
    const bounds = allDayUtcBounds(
      datePart(g.start.dateTime),
      datePart(g.end.dateTime),
    );
    startAt = bounds.startAt;
    endAt = bounds.endAt;
  } else {
    startAt = parseGraphDateTime(g.start);
    endAt = parseGraphDateTime(g.end);
    timezone = g.start.timeZone ?? g.end.timeZone ?? null;
  }

  const recurrenceId = g.originalStart ? new Date(g.originalStart) : null;

  return {
    providerEventId: g.id,
    icalUid: g.iCalUId ?? null,
    etag: g["@odata.etag"] ?? null,
    sequence: 0,
    title: g.subject ?? "",
    description: descriptionOf(g),
    location: g.location?.displayName?.trim()
      ? g.location.displayName
      : null,
    startAt,
    endAt,
    isAllDay,
    timezone,
    status: mapStatus(g),
    transparency: mapTransparency(g.showAs),
    rrule: graphRecurrenceToRrule(g.recurrence),
    rdate: null,
    exdate: null,
    masterProviderEventId: g.seriesMasterId ?? null,
    recurrenceId,
    organizerJson: g.organizer ?? null,
    attendeesJson: g.attendees ?? null,
    rawJson: raw,
  };
}
