import { google, type calendar_v3 } from "googleapis";
import { mapGoogleEvent } from "./map-google";
import type {
  CalendarAdapter,
  EventInput,
  PullResult,
  RecurrenceEdit,
  RemoteCalendar,
  RemoteEvent,
} from "./types";

type GoogleClient = calendar_v3.Calendar;
type GoogleEvent = calendar_v3.Schema$Event;

const INSTANCE_TIMED = /^(.*)_(\d{8}T\d{6}Z)$/;
const INSTANCE_ALLDAY = /^(.*)_(\d{8})$/;

function isGone(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const code = rec.response?.status ?? rec.status ?? rec.code;
  return Number(code) === 410;
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function masterProviderId(providerEventId: string): string {
  const timed = INSTANCE_TIMED.exec(providerEventId);
  if (timed?.[1]) return timed[1];
  const allDay = INSTANCE_ALLDAY.exec(providerEventId);
  if (allDay?.[1]) return allDay[1];
  return providerEventId;
}

function isInstanceId(providerEventId: string): boolean {
  return (
    INSTANCE_TIMED.test(providerEventId) || INSTANCE_ALLDAY.test(providerEventId)
  );
}

function instanceProviderId(
  event: { providerEventId: string; recurrenceId: Date | null },
  isAllDay: boolean,
): string {
  if (!event.recurrenceId) return event.providerEventId;
  if (isInstanceId(event.providerEventId)) return event.providerEventId;
  const stamp = isAllDay
    ? ymdUtc(event.recurrenceId).replace(/-/g, "")
    : compactUtc(event.recurrenceId);
  return `${event.providerEventId}_${stamp}`;
}

function ifMatch(etag: string | null):
  | { headers: { "If-Match": string } }
  | undefined {
  if (!etag) return undefined;
  return { headers: { "If-Match": etag } };
}

function toGoogleEvent(
  input: EventInput,
  opts?: { includeRecurrence?: boolean },
): GoogleEvent {
  const body: GoogleEvent = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };
  if (input.isAllDay) {
    body.start = { date: ymdUtc(input.startAt) };
    body.end = { date: ymdUtc(input.endAt) };
  } else {
    const timeZone = input.timezone ?? undefined;
    body.start = { dateTime: input.startAt.toISOString(), timeZone };
    body.end = { dateTime: input.endAt.toISOString(), timeZone };
  }
  if ((opts?.includeRecurrence ?? true) && input.rrule) {
    const rule = input.rrule.replace(/^RRULE:/i, "");
    body.recurrence = [`RRULE:${rule}`];
  }
  return body;
}

function rruleWithUntil(lines: string[] | undefined, until: string): string[] {
  const next = [...(lines ?? [])];
  const idx = next.findIndex((line) => line.toUpperCase().startsWith("RRULE"));
  const raw = idx >= 0 ? next[idx]! : "RRULE:FREQ=DAILY";
  const colon = raw.indexOf(":");
  const body = colon >= 0 ? raw.slice(colon + 1) : raw;
  const parts = body.split(";").filter((part) => {
    const key = part.split("=")[0]?.toUpperCase();
    return key !== "UNTIL" && key !== "COUNT" && part.length > 0;
  });
  parts.push(`UNTIL=${until}`);
  const line = `RRULE:${parts.join(";")}`;
  if (idx >= 0) {
    next[idx] = line;
    return next;
  }
  return [line, ...next];
}

function untilBefore(splitAt: Date, isAllDay: boolean): string {
  if (isAllDay) {
    const prev = new Date(splitAt.getTime() - 24 * 60 * 60 * 1000);
    return ymdUtc(prev).replace(/-/g, "");
  }
  return compactUtc(new Date(splitAt.getTime() - 1000));
}

function masterIsAllDay(master: GoogleEvent): boolean {
  return Boolean(master.start?.date);
}

function mapCalendar(raw: unknown): RemoteCalendar | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as {
    id?: string;
    summary?: string;
    backgroundColor?: string;
    primary?: boolean;
    accessRole?: string;
    timeZone?: string;
  };
  if (!c.id) return null;
  const role = c.accessRole ?? "";
  return {
    providerCalendarId: c.id,
    name: c.summary ?? c.id,
    color: c.backgroundColor ?? null,
    isPrimary: Boolean(c.primary),
    isReadOnly: role !== "owner" && role !== "writer",
    timezone: c.timeZone ?? null,
  };
}

function partitionEvents(items: unknown[]): {
  upserts: RemoteEvent[];
  deletedProviderIds: string[];
} {
  const upserts: RemoteEvent[] = [];
  const deletedProviderIds: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      id?: string;
      status?: string;
      start?: unknown;
      end?: unknown;
    };
    if (typeof rec.id !== "string") continue;
    const cancelled = rec.status === "cancelled";
    const hasBounds = rec.start != null && rec.end != null;
    if (cancelled && !hasBounds) {
      deletedProviderIds.push(rec.id);
      continue;
    }
    try {
      upserts.push(mapGoogleEvent(item));
    } catch (err) {
      if (cancelled) {
        deletedProviderIds.push(rec.id);
        continue;
      }
      throw err;
    }
  }
  return { upserts, deletedProviderIds };
}

async function listCalendarsPage(
  client: GoogleClient,
): Promise<RemoteCalendar[]> {
  const calendars: RemoteCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.calendarList.list(
      pageToken ? { pageToken } : {},
    );
    for (const item of res.data.items ?? []) {
      const mapped = mapCalendar(item);
      if (mapped) calendars.push(mapped);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return calendars;
}

async function listEventPages(
  client: GoogleClient,
  calendarId: string,
  syncToken: string | null,
  pageToken: string | null,
): Promise<{ items: unknown[]; nextSyncToken: string | null }> {
  const items: unknown[] = [];
  let nextPage = pageToken ?? undefined;
  let nextSyncToken: string | null = null;
  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      singleEvents: false,
      showDeleted: true,
    };
    if (syncToken) params.syncToken = syncToken;
    if (nextPage) params.pageToken = nextPage;
    const res = await client.events.list(params);
    items.push(...(res.data.items ?? []));
    nextPage = res.data.nextPageToken ?? undefined;
    if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
  } while (nextPage);
  return { items, nextSyncToken };
}

async function pullEvents(
  client: GoogleClient,
  calendar: { providerCalendarId: string; syncToken: string | null },
  cursor: string | null,
  reset: boolean,
): Promise<PullResult> {
  const { items, nextSyncToken } = await listEventPages(
    client,
    calendar.providerCalendarId,
    calendar.syncToken,
    cursor,
  );
  const { upserts, deletedProviderIds } = partitionEvents(items);
  return {
    upserts,
    deletedProviderIds,
    cursor: nextSyncToken,
    reset,
    complete: true,
  };
}

async function getEvent(
  client: GoogleClient,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent> {
  const res = await client.events.get({ calendarId, eventId });
  return res.data;
}

async function resolveInstanceId(
  client: GoogleClient,
  calendarId: string,
  event: {
    providerEventId: string;
    recurrenceId: Date | null;
  },
): Promise<string> {
  if (!event.recurrenceId || isInstanceId(event.providerEventId)) {
    return event.providerEventId;
  }
  const master = await getEvent(client, calendarId, event.providerEventId);
  return instanceProviderId(event, masterIsAllDay(master));
}

async function truncateMaster(
  client: GoogleClient,
  calendarId: string,
  event: { providerEventId: string },
  splitAt: Date,
): Promise<void> {
  const masterId = masterProviderId(event.providerEventId);
  const master = await getEvent(client, calendarId, masterId);
  const until = untilBefore(splitAt, masterIsAllDay(master));
  await client.events.patch(
    {
      calendarId,
      eventId: masterId,
      requestBody: {
        recurrence: rruleWithUntil(master.recurrence ?? undefined, until),
      },
    },
    ifMatch(master.etag ?? null),
  );
}

function splitAtForFollowing(
  event: { recurrenceId: Date | null },
  fallback?: Date,
): Date {
  const splitAt = event.recurrenceId ?? fallback;
  if (!splitAt) {
    throw new Error("Google thisAndFollowing requires recurrenceId");
  }
  return splitAt;
}

export function createGoogleAdapter(tokens: {
  accessToken: string;
}): CalendarAdapter {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: tokens.accessToken });
  const client = google.calendar({ version: "v3", auth });

  return {
    async listCalendars(): Promise<RemoteCalendar[]> {
      return listCalendarsPage(client);
    },

    async pull(
      calendar: { providerCalendarId: string; syncToken: string | null },
      cursor: string | null,
    ): Promise<PullResult> {
      try {
        return await pullEvents(client, calendar, cursor, false);
      } catch (err) {
        if (!isGone(err) || !calendar.syncToken) throw err;
        return pullEvents(
          client,
          { providerCalendarId: calendar.providerCalendarId, syncToken: null },
          null,
          true,
        );
      }
    },

    async createEvent(
      calendar: { providerCalendarId: string },
      input: EventInput,
    ): Promise<RemoteEvent> {
      const res = await client.events.insert({
        calendarId: calendar.providerCalendarId,
        requestBody: toGoogleEvent(input),
      });
      return mapGoogleEvent(res.data);
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
        const inserted = await client.events.insert({
          calendarId,
          requestBody: toGoogleEvent(input),
        });
        return mapGoogleEvent(inserted.data);
      }
      if (range === "all") {
        const masterId = masterProviderId(event.providerEventId);
        const master = await getEvent(client, calendarId, masterId);
        const res = await client.events.patch(
          {
            calendarId,
            eventId: masterId,
            requestBody: toGoogleEvent(input),
          },
          ifMatch(master.etag ?? null),
        );
        return mapGoogleEvent(res.data);
      }
      const eventId = await resolveInstanceId(client, calendarId, event);
      const res = await client.events.patch(
        {
          calendarId,
          eventId,
          requestBody: toGoogleEvent(input, { includeRecurrence: false }),
        },
        ifMatch(event.etag),
      );
      return mapGoogleEvent(res.data);
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
        const masterId = masterProviderId(event.providerEventId);
        const master = await getEvent(client, calendarId, masterId);
        await client.events.delete(
          { calendarId, eventId: masterId },
          ifMatch(master.etag ?? null),
        );
        return;
      }
      const eventId = await resolveInstanceId(client, calendarId, event);
      await client.events.delete({ calendarId, eventId }, ifMatch(event.etag));
    },

    async respond(
      calendar: { providerCalendarId: string },
      event: { providerEventId: string },
      status: "accepted" | "tentative" | "declined",
    ): Promise<RemoteEvent> {
      const calendarId = calendar.providerCalendarId;
      const eventId = event.providerEventId;
      const current = await getEvent(client, calendarId, eventId);
      const attendees = Array.isArray(current.attendees)
        ? current.attendees
        : [];
      let found = false;
      const next = attendees.map((attendee) => {
        if (attendee && typeof attendee === "object" && attendee.self) {
          found = true;
          return { ...attendee, responseStatus: status };
        }
        return attendee;
      });
      if (!found) {
        throw new Error("Google respond: authenticated user is not an attendee");
      }
      const res = await client.events.patch({
        calendarId,
        eventId,
        requestBody: { attendees: next },
      });
      return mapGoogleEvent(res.data);
    },
  };
}
