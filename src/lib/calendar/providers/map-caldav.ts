import ICAL from "ical.js";
import type { RemoteEvent } from "./types";

type CalDavRaw = {
  href?: string;
  url?: string;
  etag?: string | null;
  data?: string;
  ics?: string;
};

function asRecord(raw: unknown): CalDavRaw {
  if (typeof raw === "string") {
    return { data: raw };
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("mapCalDavEvent: expected an object or ICS string");
  }
  return raw as CalDavRaw;
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

function propString(
  vevent: ICAL.Component,
  name: string,
): string | null {
  const value = vevent.getFirstPropertyValue(name);
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Compact UTC stamp matching expand.ts parseUtcStamps (YYYYMMDDTHHMMSSZ). */
function toCompactUtcStamp(time: ICAL.Time): string {
  if (time.isDate) {
    return `${time.year}${pad2(time.month)}${pad2(time.day)}T000000Z`;
  }
  const utc = time.convertToZone(ICAL.Timezone.utcTimezone);
  return `${utc.year}${pad2(utc.month)}${pad2(utc.day)}T${pad2(utc.hour)}${pad2(utc.minute)}${pad2(utc.second)}Z`;
}

function asIcalTime(value: unknown): ICAL.Time | null {
  if (!value || typeof value !== "object") return null;
  if ("year" in value && "month" in value && "day" in value) {
    return value as ICAL.Time;
  }
  // RDATE;VALUE=PERIOD → use period start
  if ("start" in value && (value as { start?: unknown }).start) {
    return asIcalTime((value as { start: unknown }).start);
  }
  return null;
}

/** Normalize EXDATE/RDATE to comma-joined compact UTC stamps for expand.ts. */
function stampProps(
  vevent: ICAL.Component,
  name: string,
): string | null {
  const props = vevent.getAllProperties(name);
  if (!props.length) return null;
  const parts: string[] = [];
  for (const prop of props) {
    const values =
      typeof prop.getValues === "function" ? prop.getValues() : [prop.getFirstValue()];
    for (const v of values) {
      const time = asIcalTime(v);
      if (time) parts.push(toCompactUtcStamp(time));
    }
  }
  return parts.length ? parts.join(",") : null;
}

function mapStatus(raw: string | null): RemoteEvent["status"] {
  const upper = (raw ?? "").toUpperCase();
  if (upper === "CANCELLED") return "cancelled";
  if (upper === "TENTATIVE") return "tentative";
  return "confirmed";
}

function mapTransparency(raw: string | null): RemoteEvent["transparency"] {
  return (raw ?? "").toUpperCase() === "TRANSPARENT" ? "free" : "busy";
}

function organizerJson(vevent: ICAL.Component): unknown {
  const prop = vevent.getFirstProperty("organizer");
  if (!prop) return null;
  const value = prop.getFirstValue()?.toString() ?? null;
  const cn = prop.getParameter("cn")?.toString() ?? null;
  return { value, cn };
}

function attendeesJson(vevent: ICAL.Component): unknown {
  const props = vevent.getAllProperties("attendee");
  if (!props.length) return null;
  return props.map((prop) => ({
    value: prop.getFirstValue()?.toString() ?? null,
    cn: prop.getParameter("cn")?.toString() ?? null,
    partstat: prop.getParameter("partstat")?.toString() ?? null,
    role: prop.getParameter("role")?.toString() ?? null,
  }));
}

function providerIdOf(raw: CalDavRaw, uid: string): string {
  const href = raw.href ?? raw.url;
  if (href && href.trim()) return href.trim();
  return uid;
}

export function mapCalDavEvent(raw: unknown): RemoteEvent {
  const input = asRecord(raw);
  const ics = input.data ?? input.ics;
  if (!ics || typeof ics !== "string") {
    throw new Error("mapCalDavEvent: missing ICS data");
  }

  let vevent: ICAL.Component;
  try {
    const jcal = ICAL.parse(ics);
    const vcalendar = new ICAL.Component(jcal);
    ICAL.helpers.updateTimezones(vcalendar);
    const found = vcalendar.getFirstSubcomponent("vevent");
    if (!found) {
      throw new Error("mapCalDavEvent: no VEVENT");
    }
    vevent = found;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("mapCalDavEvent:")) {
      throw err;
    }
    throw new Error("mapCalDavEvent: invalid ICS");
  }

  const event = new ICAL.Event(vevent);
  const uid = event.uid?.trim();
  if (!uid) {
    throw new Error("mapCalDavEvent: missing UID");
  }

  const start = event.startDate;
  const end = event.endDate;
  const startAt = timeToDate(start);
  const endAt = timeToDate(end);
  if (!startAt || !endAt) {
    throw new Error("mapCalDavEvent: missing DTSTART/DTEND");
  }

  const isAllDay = Boolean(start?.isDate);
  const timezone = !isAllDay && start?.zone?.tzid ? start.zone.tzid : null;

  const sequenceRaw = vevent.getFirstPropertyValue("sequence");
  const sequence =
    typeof sequenceRaw === "number"
      ? sequenceRaw
      : Number.parseInt(String(sequenceRaw ?? "0"), 10) || 0;

  return {
    providerEventId: providerIdOf(input, uid),
    icalUid: uid,
    etag: input.etag ?? null,
    sequence,
    title: event.summary ?? "",
    description: event.description?.trim() ? event.description : null,
    location: event.location?.trim() ? event.location : null,
    startAt,
    endAt,
    isAllDay,
    timezone,
    status: mapStatus(propString(vevent, "status")),
    transparency: mapTransparency(propString(vevent, "transp")),
    rrule: propString(vevent, "rrule"),
    rdate: stampProps(vevent, "rdate"),
    exdate: stampProps(vevent, "exdate"),
    masterProviderEventId: null,
    recurrenceId: timeToDate(event.recurrenceId),
    organizerJson: organizerJson(vevent),
    attendeesJson: attendeesJson(vevent),
    rawJson: raw,
  };
}
