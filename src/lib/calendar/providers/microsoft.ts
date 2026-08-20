import { Client } from "@microsoft/microsoft-graph-client";
import { mapGraphEvent } from "./map-graph";
import type {
  CalendarAdapter,
  EventInput,
  PullResult,
  RecurrenceEdit,
  RemoteCalendar,
  RemoteEvent,
} from "./types";

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

type GraphRecurrence = {
  pattern?: GraphRecurrencePattern;
  range?: GraphRecurrenceRange;
};

type GraphEvent = {
  id?: string;
  "@odata.etag"?: string;
  changeKey?: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
  seriesMasterId?: string | null;
  type?: string;
  originalStart?: string;
  recurrence?: GraphRecurrence | null;
  "@removed"?: { reason?: string } | null;
};

type ODataCollection<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

const PREFER_UTC = 'outlook.timezone="UTC"';

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const BYDAY_TO_GRAPH: Record<string, string> = {
  SU: "sunday",
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday",
};

const ORDINAL_TO_INDEX: Record<string, string> = {
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "-1": "last",
};

function isGone(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  const status = rec.statusCode ?? rec.response?.status ?? rec.status;
  if (Number(status) === 410) return true;
  const code = String(rec.code ?? "").toLowerCase();
  return code === "gone" || code === "syncstatenotfound";
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcGraphDateTime(date: Date): string {
  return date.toISOString().replace(/Z$/, "");
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function wallClockDateTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000`;
}

function timedGraphSlot(
  date: Date,
  timeZone: string | null,
): GraphDateTime {
  const tz = timeZone && timeZone.length > 0 ? timeZone : "UTC";
  if (tz === "UTC" || tz === "Etc/UTC") {
    return { dateTime: utcGraphDateTime(date), timeZone: "UTC" };
  }
  try {
    return { dateTime: wallClockDateTime(date, tz), timeZone: tz };
  } catch {
    return { dateTime: utcGraphDateTime(date), timeZone: "UTC" };
  }
}

function rruleStartAt(date: Date, timeZone: string | null): Date {
  const tz = timeZone && timeZone.length > 0 ? timeZone : "UTC";
  if (tz === "UTC" || tz === "Etc/UTC") return date;
  try {
    const p = zonedParts(date, tz);
    return new Date(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`,
    );
  } catch {
    return date;
  }
}

function calendarPath(calendarId: string): string {
  return `/me/calendars/${encodeURIComponent(calendarId)}`;
}

function eventsPath(calendarId: string): string {
  return `${calendarPath(calendarId)}/events`;
}

function eventsDeltaPath(calendarId: string): string {
  return `${eventsPath(calendarId)}/delta`;
}

function eventPath(calendarId: string, eventId: string): string {
  return `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`;
}

function etagOf(event: GraphEvent): string | null {
  if (event["@odata.etag"]) return event["@odata.etag"];
  if (event.changeKey) return `W/"${event.changeKey}"`;
  return null;
}

function eventRequest(
  client: Client,
  path: string,
  etag?: string | null,
) {
  let req = client.api(path).header("Prefer", PREFER_UTC);
  if (etag) req = req.header("If-Match", etag);
  return req;
}

function parseRruleParts(rrule: string): Record<string, string> {
  const raw = rrule.replace(/^RRULE:/i, "").trim();
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.length === 0) continue;
    out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

function parseUntilDate(until: string): string {
  const compact = until.replace(/[-:]/g, "");
  if (/^\d{8}/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  const parsed = new Date(until);
  if (!Number.isNaN(parsed.getTime())) return ymdUtc(parsed);
  return until.slice(0, 10);
}

function rruleToGraph(
  rrule: string,
  startAt: Date,
): GraphRecurrence | undefined {
  const parts = parseRruleParts(rrule);
  const freq = parts.FREQ?.toUpperCase();
  if (!freq) return undefined;

  const byday = parts.BYDAY ? parts.BYDAY.split(",") : [];
  const days: { ordinal?: string; day: string }[] = [];
  for (const token of byday) {
    const match = /^(-?\d+)?([A-Z]{2})$/i.exec(token.trim());
    if (!match) continue;
    const day = BYDAY_TO_GRAPH[match[2]!.toUpperCase()];
    if (!day) continue;
    days.push({ ordinal: match[1], day });
  }
  const hasOrdinal = days.some((d) => d.ordinal);

  let type: string;
  if (freq === "DAILY") type = "daily";
  else if (freq === "WEEKLY") type = "weekly";
  else if (freq === "MONTHLY") type = hasOrdinal ? "relativeMonthly" : "absoluteMonthly";
  else if (freq === "YEARLY") type = hasOrdinal ? "relativeYearly" : "absoluteYearly";
  else return undefined;

  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const pattern: GraphRecurrencePattern = {
    type,
    interval: interval > 0 ? interval : 1,
  };

  if (type === "weekly" || type.startsWith("relative")) {
    const names = days.map((d) => d.day);
    if (names.length) pattern.daysOfWeek = names;
    else if (type === "weekly") {
      pattern.daysOfWeek = [WEEKDAYS[startAt.getUTCDay()] ?? "monday"];
    }
  }

  if (hasOrdinal) {
    const ordinal = days.find((d) => d.ordinal)?.ordinal;
    const index = ordinal ? ORDINAL_TO_INDEX[ordinal] : undefined;
    if (index) pattern.index = index;
  }

  if (type === "absoluteMonthly" || type === "absoluteYearly") {
    pattern.dayOfMonth = parts.BYMONTHDAY
      ? Number(parts.BYMONTHDAY.split(",")[0])
      : startAt.getUTCDate();
  }

  if (type === "absoluteYearly" || type === "relativeYearly") {
    pattern.month = parts.BYMONTH
      ? Number(parts.BYMONTH.split(",")[0])
      : startAt.getUTCMonth() + 1;
  }

  if (parts.WKST) {
    const wkst = BYDAY_TO_GRAPH[parts.WKST.toUpperCase()];
    if (wkst) pattern.firstDayOfWeek = wkst;
  }

  const range: GraphRecurrenceRange = {
    type: "noEnd",
    startDate: ymdUtc(startAt),
  };
  if (parts.UNTIL) {
    range.type = "endDate";
    range.endDate = parseUntilDate(parts.UNTIL);
  } else if (parts.COUNT) {
    range.type = "numbered";
    range.numberOfOccurrences = Number(parts.COUNT);
  }

  return { pattern, range };
}

function toGraphEvent(
  input: EventInput,
  opts?: { includeRecurrence?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: input.title,
    isAllDay: input.isAllDay,
  };
  if (input.description != null) {
    body.body = { contentType: "text", content: input.description };
  }
  if (input.location != null) {
    body.location = { displayName: input.location };
  }
  if (input.isAllDay) {
    body.start = { dateTime: `${ymdUtc(input.startAt)}T00:00:00.0000000`, timeZone: "UTC" };
    body.end = { dateTime: `${ymdUtc(input.endAt)}T00:00:00.0000000`, timeZone: "UTC" };
  } else {
    body.start = timedGraphSlot(input.startAt, input.timezone);
    body.end = timedGraphSlot(input.endAt, input.timezone);
  }
  if ((opts?.includeRecurrence ?? true) && input.rrule) {
    const recurrence = rruleToGraph(
      input.rrule,
      rruleStartAt(input.startAt, input.timezone),
    );
    if (recurrence) body.recurrence = recurrence;
  }
  return body;
}

function mapCalendar(raw: unknown): RemoteCalendar | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as {
    id?: string;
    name?: string;
    hexColor?: string;
    isDefaultCalendar?: boolean;
    canEdit?: boolean;
  };
  if (!c.id) return null;
  const hex = c.hexColor?.trim();
  return {
    providerCalendarId: c.id,
    name: c.name ?? c.id,
    color: hex && hex !== "auto" ? hex : null,
    isPrimary: Boolean(c.isDefaultCalendar),
    isReadOnly: c.canEdit !== true,
    timezone: null,
  };
}

function isRemoved(item: GraphEvent): boolean {
  return item["@removed"] != null;
}

function partitionEvents(items: unknown[]): {
  upserts: RemoteEvent[];
  deletedProviderIds: string[];
} {
  const upserts: RemoteEvent[] = [];
  const deletedProviderIds: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as GraphEvent;
    if (typeof rec.id !== "string") continue;
    const cancelled = Boolean(rec.isCancelled);
    const hasBounds = rec.start != null && rec.end != null;
    if (isRemoved(rec) || (cancelled && !hasBounds)) {
      deletedProviderIds.push(rec.id);
      continue;
    }
    try {
      upserts.push(mapGraphEvent(item));
    } catch (err) {
      if (cancelled || isRemoved(rec)) {
        deletedProviderIds.push(rec.id);
        continue;
      }
      throw err;
    }
  }
  return { upserts, deletedProviderIds };
}

async function listCalendarsPage(client: Client): Promise<RemoteCalendar[]> {
  const calendars: RemoteCalendar[] = [];
  let url: string | undefined = "/me/calendars";
  while (url) {
    const res = (await client.api(url).get()) as ODataCollection<unknown>;
    for (const item of res.value ?? []) {
      const mapped = mapCalendar(item);
      if (mapped) calendars.push(mapped);
    }
    url = res["@odata.nextLink"];
  }
  return calendars;
}

async function listEventPages(
  client: Client,
  calendarId: string,
  token: string | null,
): Promise<{ items: unknown[]; deltaLink: string | null }> {
  const items: unknown[] = [];
  let url: string | undefined = token && token.length > 0 ? token : eventsDeltaPath(calendarId);
  let deltaLink: string | null = null;
  while (url) {
    const res = (await eventRequest(client, url).get()) as ODataCollection<unknown>;
    items.push(...(res.value ?? []));
    url = res["@odata.nextLink"];
    if (res["@odata.deltaLink"]) deltaLink = res["@odata.deltaLink"];
  }
  return { items, deltaLink };
}

async function pullEvents(
  client: Client,
  calendarId: string,
  token: string | null,
  reset: boolean,
): Promise<PullResult> {
  const { items, deltaLink } = await listEventPages(client, calendarId, token);
  const { upserts, deletedProviderIds } = partitionEvents(items);
  return {
    upserts,
    deletedProviderIds,
    cursor: deltaLink,
    reset,
    complete: true,
  };
}

async function getEvent(
  client: Client,
  calendarId: string,
  eventId: string,
): Promise<GraphEvent> {
  return (await eventRequest(client, eventPath(calendarId, eventId)).get()) as GraphEvent;
}

async function getMaster(
  client: Client,
  calendarId: string,
  event: { providerEventId: string },
): Promise<GraphEvent> {
  const current = await getEvent(client, calendarId, event.providerEventId);
  if (current.seriesMasterId && current.seriesMasterId !== current.id) {
    return getEvent(client, calendarId, current.seriesMasterId);
  }
  return current;
}

function parseGraphInstant(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed
    : `${trimmed.replace(/(\.\d{3})\d+/, "$1")}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function instanceMatchesRecurrence(
  item: GraphEvent,
  recurrenceId: Date,
): boolean {
  const original = parseGraphInstant(item.originalStart);
  if (original && original.getTime() === recurrenceId.getTime()) return true;
  const start = parseGraphInstant(item.start?.dateTime);
  return Boolean(start && start.getTime() === recurrenceId.getTime());
}

function instancesPath(
  calendarId: string,
  masterId: string,
  start: Date,
  end: Date,
): string {
  const qs = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  });
  return `${eventPath(calendarId, masterId)}/instances?${qs.toString()}`;
}

async function findOccurrence(
  client: Client,
  calendarId: string,
  masterId: string,
  recurrenceId: Date,
): Promise<GraphEvent> {
  const end = new Date(recurrenceId.getTime() + 24 * 60 * 60 * 1000);
  const res = (await eventRequest(
    client,
    instancesPath(calendarId, masterId, recurrenceId, end),
  ).get()) as ODataCollection<GraphEvent>;
  const values = res.value ?? [];
  const matched =
    values.find((item) => instanceMatchesRecurrence(item, recurrenceId)) ??
    (values.length === 1 ? values[0] : undefined);
  if (!matched?.id) {
    throw new Error("Microsoft this: occurrence not found for recurrenceId");
  }
  return matched;
}

async function resolveThisTarget(
  client: Client,
  calendarId: string,
  event: {
    providerEventId: string;
    etag: string | null;
    recurrenceId: Date | null;
  },
): Promise<{ id: string; etag: string | null }> {
  if (!event.recurrenceId) {
    return { id: event.providerEventId, etag: event.etag };
  }
  const occurrence = await findOccurrence(
    client,
    calendarId,
    event.providerEventId,
    event.recurrenceId,
  );
  return { id: occurrence.id!, etag: etagOf(occurrence) ?? event.etag };
}

function splitAtForFollowing(
  event: { recurrenceId: Date | null },
  fallback?: Date,
): Date {
  const splitAt = event.recurrenceId ?? fallback;
  if (!splitAt) {
    throw new Error("Microsoft thisAndFollowing requires recurrenceId");
  }
  return splitAt;
}

function untilEndDate(splitAt: Date): string {
  const prev = new Date(
    Date.UTC(
      splitAt.getUTCFullYear(),
      splitAt.getUTCMonth(),
      splitAt.getUTCDate() - 1,
    ),
  );
  return ymdUtc(prev);
}

async function truncateMaster(
  client: Client,
  calendarId: string,
  event: { providerEventId: string },
  splitAt: Date,
): Promise<GraphEvent> {
  const master = await getMaster(client, calendarId, event);
  if (!master.id) {
    throw new Error("Microsoft thisAndFollowing: series master has no id");
  }
  const recurrence = master.recurrence ?? {};
  const range: GraphRecurrenceRange = {
    ...(recurrence.range ?? {}),
    type: "endDate",
    startDate: recurrence.range?.startDate ?? ymdUtc(splitAt),
    endDate: untilEndDate(splitAt),
  };
  await eventRequest(client, eventPath(calendarId, master.id), etagOf(master)).patch({
    recurrence: {
      pattern: recurrence.pattern,
      range,
    },
  });
  return master;
}

function respondAction(
  status: "accepted" | "tentative" | "declined",
): "accept" | "tentativelyAccept" | "decline" {
  if (status === "accepted") return "accept";
  if (status === "tentative") return "tentativelyAccept";
  return "decline";
}

export function createMicrosoftAdapter(tokens: {
  accessToken: string;
}): CalendarAdapter {
  const client = Client.init({
    authProvider: (done) => {
      done(null, tokens.accessToken);
    },
  });

  return {
    async listCalendars(): Promise<RemoteCalendar[]> {
      return listCalendarsPage(client);
    },

    async pull(
      calendar: { providerCalendarId: string; syncToken: string | null },
      cursor: string | null,
    ): Promise<PullResult> {
      const start = cursor ?? calendar.syncToken;
      try {
        return await pullEvents(
          client,
          calendar.providerCalendarId,
          start,
          false,
        );
      } catch (err) {
        if (!isGone(err) || !start) throw err;
        return pullEvents(client, calendar.providerCalendarId, null, true);
      }
    },

    async createEvent(
      calendar: { providerCalendarId: string },
      input: EventInput,
    ): Promise<RemoteEvent> {
      const res = await eventRequest(
        client,
        eventsPath(calendar.providerCalendarId),
      ).post(toGraphEvent(input));
      return mapGraphEvent(res);
    },

    async getEvent(
      calendar: { providerCalendarId: string },
      providerEventId: string,
    ): Promise<RemoteEvent> {
      const data = await getEvent(
        client,
        calendar.providerCalendarId,
        providerEventId,
      );
      return mapGraphEvent(data);
    },

    async moveEvent(
      from: { providerCalendarId: string },
      to: { providerCalendarId: string },
      event: { providerEventId: string; etag: string | null },
    ): Promise<RemoteEvent> {
      const res = await eventRequest(
        client,
        `${eventPath(from.providerCalendarId, event.providerEventId)}/move`,
        event.etag,
      ).post({ destinationId: to.providerCalendarId });
      return mapGraphEvent(res);
    },

    async updateEvent(
      calendar: { providerCalendarId: string },
      event: {
        providerEventId: string;
        etag: string | null;
        recurrenceId: Date | null;
      },
      input: EventInput,
      range: RecurrenceEdit,
    ): Promise<RemoteEvent> {
      const calendarId = calendar.providerCalendarId;
      if (range === "thisAndFollowing") {
        await truncateMaster(
          client,
          calendarId,
          event,
          splitAtForFollowing(event, input.startAt),
        );
        const created = await eventRequest(client, eventsPath(calendarId)).post(
          toGraphEvent(input),
        );
        return mapGraphEvent(created);
      }
      if (range === "all") {
        const master = await getMaster(client, calendarId, event);
        if (!master.id) {
          throw new Error("Microsoft update all: series master has no id");
        }
        const res = await eventRequest(
          client,
          eventPath(calendarId, master.id),
          etagOf(master),
        ).patch(toGraphEvent(input));
        return mapGraphEvent(res);
      }
      const target = await resolveThisTarget(client, calendarId, event);
      const res = await eventRequest(
        client,
        eventPath(calendarId, target.id),
        target.etag,
      ).patch(toGraphEvent(input, { includeRecurrence: false }));
      return mapGraphEvent(res);
    },

    async deleteEvent(
      calendar: { providerCalendarId: string },
      event: {
        providerEventId: string;
        etag: string | null;
        recurrenceId: Date | null;
      },
      range: RecurrenceEdit,
    ): Promise<void> {
      const calendarId = calendar.providerCalendarId;
      if (range === "thisAndFollowing") {
        await truncateMaster(
          client,
          calendarId,
          event,
          splitAtForFollowing(event),
        );
        return;
      }
      if (range === "all") {
        const master = await getMaster(client, calendarId, event);
        if (!master.id) {
          throw new Error("Microsoft delete all: series master has no id");
        }
        await eventRequest(
          client,
          eventPath(calendarId, master.id),
          etagOf(master),
        ).delete();
        return;
      }
      const target = await resolveThisTarget(client, calendarId, event);
      await eventRequest(
        client,
        eventPath(calendarId, target.id),
        target.etag,
      ).delete();
    },

    async respond(
      calendar: { providerCalendarId: string },
      event: { providerEventId: string },
      status: "accepted" | "tentative" | "declined",
    ): Promise<RemoteEvent> {
      const calendarId = calendar.providerCalendarId;
      const action = respondAction(status);
      await eventRequest(
        client,
        `${eventPath(calendarId, event.providerEventId)}/${action}`,
      ).post({ sendResponse: true });
      const updated = await getEvent(client, calendarId, event.providerEventId);
      return mapGraphEvent(updated);
    },
  };
}
