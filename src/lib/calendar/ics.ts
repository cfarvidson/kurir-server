import ICAL from "ical.js";

export type IcsMethod =
  | "REQUEST"
  | "CANCEL"
  | "REPLY"
  | "PUBLISH"
  | "COUNTER";

export type ParsedIcs = {
  uid: string;
  method: IcsMethod;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isAllDay: boolean;
  location: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  recurrenceId: Date | null;
  rrule: string | null;
};

const ICS_METHODS = new Set<string>([
  "REQUEST",
  "CANCEL",
  "REPLY",
  "PUBLISH",
  "COUNTER",
]);

export function isCalendarPart(
  contentType: string,
  filename: string | null,
): boolean {
  const media = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (media.startsWith("text/calendar")) return true;
  if (filename && filename.toLowerCase().endsWith(".ics")) return true;
  return false;
}

function normalizeMethod(raw: unknown): IcsMethod {
  const upper = String(raw ?? "PUBLISH").toUpperCase();
  if (ICS_METHODS.has(upper)) return upper as IcsMethod;
  return "PUBLISH";
}

function stripMailto(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^mailto:/i, "");
}

/** Convert ICAL.Time to Date. VALUE=DATE uses exclusive-end midnight UTC. */
function timeToDate(time: ICAL.Time | null | undefined): Date | null {
  if (!time) return null;
  if (time.isDate) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }
  const utc = time.convertToZone(ICAL.Timezone.utcTimezone);
  return utc.toJSDate();
}

function rruleString(
  vevent: ICAL.Component,
): string | null {
  const value = vevent.getFirstPropertyValue("rrule");
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }
  return null;
}

export function parseIcs(raw: string): ParsedIcs | null {
  try {
    const jcal = ICAL.parse(raw);
    const vcalendar = new ICAL.Component(jcal);
    ICAL.helpers.updateTimezones(vcalendar);

    const vevent = vcalendar.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);
    const uid = event.uid?.trim();
    if (!uid) return null;

    const organizerProp = vevent.getFirstProperty("organizer");
    const organizerEmail = stripMailto(
      organizerProp?.getFirstValue()?.toString() ?? event.organizer ?? null,
    );
    const organizerName =
      organizerProp?.getParameter("cn")?.toString()?.trim() || null;

    const start = event.startDate;
    const isAllDay = Boolean(start?.isDate);

    return {
      uid,
      method: normalizeMethod(vcalendar.getFirstPropertyValue("method")),
      title: event.summary ?? "",
      startAt: timeToDate(start),
      endAt: timeToDate(event.endDate),
      isAllDay,
      location: event.location?.trim() ? event.location : null,
      organizerEmail,
      organizerName,
      recurrenceId: timeToDate(event.recurrenceId),
      rrule: rruleString(vevent),
    };
  } catch {
    return null;
  }
}
