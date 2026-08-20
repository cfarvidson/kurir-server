import { randomUUID } from "crypto";
import ICAL from "ical.js";
import { createDAVClient } from "tsdav";
import type { DAVCalendar, DAVResponse } from "tsdav";
import { instanceWindow } from "@/lib/calendar/expand";
import { mapCalDavEvent } from "./map-caldav";
import {
  CalendarConflictError,
  type CalendarAdapter,
  type EventInput,
  type PullResult,
  type RecurrenceEdit,
  type RemoteCalendar,
  type RemoteEvent,
} from "./types";

type CalDavClient = Awaited<ReturnType<typeof createDAVClient>>;

const CONFLICT_LABEL = "this calendar";
const PRODID = "-//Kurir//Calendar//EN";
const PARTSTAT: Record<"accepted" | "tentative" | "declined", string> = {
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

const EVENT_PROPS = {
  "d:getetag": {},
  "c:calendar-data": {},
};

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function collectionUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function resolveHref(href: string, base: string): string {
  try {
    return new URL(href, collectionUrl(base)).href;
  } catch {
    return href;
  }
}

function sameHref(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "_cdata" in value) {
    const cdata = (value as { _cdata?: unknown })._cdata;
    if (typeof cdata === "string" && cdata.length > 0) return cdata;
  }
  return null;
}

function calendarDataOf(props: DAVResponse["props"]): string | null {
  if (!props) return null;
  return asText(props.calendarData) ?? asText(props["calendar-data"]);
}

function etagOf(props: DAVResponse["props"]): string | null {
  if (!props) return null;
  const raw = props.getetag ?? props["getetag"];
  if (raw == null) return null;
  return String(raw);
}

function syncTokenOf(responses: DAVResponse[]): string | null {
  for (const res of responses) {
    const token = (res.raw as { multistatus?: { syncToken?: unknown } } | undefined)
      ?.multistatus?.syncToken;
    if (typeof token === "string" && token.length > 0) return token;
  }
  return null;
}

function httpStatus(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value !== "object") return null;
  const rec = value as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const n = Number(rec.status ?? rec.statusCode ?? rec.response?.status);
  return Number.isFinite(n) ? n : null;
}

function throwIfConflict(value: unknown): void {
  if (httpStatus(value) === 412) {
    throw new CalendarConflictError(CONFLICT_LABEL);
  }
}

function isHttpOk(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as { ok?: unknown };
  if (rec.ok === true) return true;
  const status = httpStatus(value);
  return status != null && status >= 200 && status < 300;
}

function assertWriteOk(value: unknown): void {
  throwIfConflict(value);
  if (isHttpOk(value)) return;
  const status = httpStatus(value);
  throw new Error(`CalDAV request failed (${status ?? "unknown"})`);
}

type SyncReportKind = "ok" | "unsupported" | "invalid-token" | "http";

class CalDavSyncReportError extends Error {
  constructor(
    readonly kind: Exclude<SyncReportKind, "ok">,
    readonly status: number | null,
  ) {
    super(`CalDAV syncCollection failed (${status ?? kind})`);
    this.name = "CalDavSyncReportError";
  }
}

function classifySyncStatus(status: number | null): SyncReportKind | null {
  if (status == null || status < 400 || status === 404) return null;
  if (status === 501) return "unsupported";
  if (status === 403 || status === 409) return "invalid-token";
  return "http";
}

function classifySyncResponses(responses: DAVResponse[]): SyncReportKind {
  let kind: SyncReportKind = "ok";
  let status: number | null = null;
  for (const res of responses) {
    const next = classifySyncStatus(Number(res.status) || httpStatus(res));
    if (!next || next === "ok") continue;
    status = httpStatus(res);
    if (next === "http" || next === "unsupported") {
      throw new CalDavSyncReportError(next, status);
    }
    kind = next;
  }
  if (kind === "invalid-token") {
    throw new CalDavSyncReportError(kind, status);
  }
  return kind;
}

function throwIfSyncThrown(err: unknown): void {
  if (err instanceof CalDavSyncReportError) throw err;
  const kind = classifySyncStatus(httpStatus(err));
  if (kind && kind !== "ok") {
    throw new CalDavSyncReportError(kind, httpStatus(err));
  }
}

function calendarName(cal: DAVCalendar): string {
  const name = cal.displayName;
  if (typeof name === "string" && name.trim()) return name;
  if (name && typeof name === "object") {
    const cdata = (name as { _cdata?: unknown })._cdata;
    if (typeof cdata === "string" && cdata.trim()) return cdata;
  }
  return cal.url;
}

function mapCalendar(cal: DAVCalendar, index: number): RemoteCalendar {
  const timezone = cal.timezone?.trim() ? cal.timezone : null;
  const color = cal.calendarColor?.trim() ? cal.calendarColor : null;
  return {
    providerCalendarId: cal.url,
    name: calendarName(cal),
    color,
    isPrimary: index === 0,
    isReadOnly: false,
    timezone,
  };
}

function timeRangeFilter(from: Date, to: Date) {
  return {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": {
        _attributes: { name: "VEVENT" },
        "time-range": {
          _attributes: {
            start: compactUtc(from),
            end: compactUtc(to),
          },
        },
      },
    },
  };
}

function partitionResponses(
  responses: DAVResponse[],
  calendarUrl: string,
): { upserts: RemoteEvent[]; deletedProviderIds: string[]; missingHrefs: string[] } {
  const upserts: RemoteEvent[] = [];
  const deletedProviderIds: string[] = [];
  const missingHrefs: string[] = [];
  for (const res of responses) {
    if (typeof res.href !== "string" || !res.href) continue;
    const href = resolveHref(res.href, calendarUrl);
    if (sameHref(href, calendarUrl)) continue;
    const status = Number(res.status);
    if (status === 404) {
      deletedProviderIds.push(href);
      continue;
    }
    if (status && status >= 400) continue;
    const data = calendarDataOf(res.props);
    const etag = etagOf(res.props);
    if (!data) {
      missingHrefs.push(href);
      continue;
    }
    upserts.push(mapCalDavEvent({ href, etag, data }));
  }
  return { upserts, deletedProviderIds, missingHrefs };
}

async function fillMissing(
  client: CalDavClient,
  calendarUrl: string,
  hrefs: string[],
): Promise<RemoteEvent[]> {
  if (hrefs.length === 0) return [];
  const responses = await client.calendarMultiGet({
    url: calendarUrl,
    props: EVENT_PROPS,
    objectUrls: hrefs,
    depth: "1",
  });
  const { upserts } = partitionResponses(responses, calendarUrl);
  return upserts;
}

function parseCalendar(ics: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(ics));
}

function asIcalTime(value: unknown): ICAL.Time | null {
  if (!value || typeof value !== "object") return null;
  if ("year" in value && "month" in value && "day" in value) {
    return value as ICAL.Time;
  }
  return null;
}

function timeToDate(time: ICAL.Time | null): Date | null {
  if (!time) return null;
  if (time.isDate) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }
  return time.convertToZone(ICAL.Timezone.utcTimezone).toJSDate();
}

function masterVevent(vcalendar: ICAL.Component): ICAL.Component {
  const events = vcalendar.getAllSubcomponents("vevent");
  const master = events.find((ev) => !ev.getFirstProperty("recurrence-id"));
  const found = master ?? events[0];
  if (!found) throw new Error("CalDAV: no VEVENT");
  return found;
}

function exceptionVevent(
  vcalendar: ICAL.Component,
  recurrenceId: Date,
): ICAL.Component | null {
  for (const ev of vcalendar.getAllSubcomponents("vevent")) {
    const rid = asIcalTime(ev.getFirstPropertyValue("recurrence-id"));
    const date = timeToDate(rid);
    if (date && date.getTime() === recurrenceId.getTime()) return ev;
  }
  return null;
}

function icalDate(date: Date, isAllDay: boolean): ICAL.Time {
  if (isAllDay) {
    return ICAL.Time.fromDateString(date.toISOString().slice(0, 10));
  }
  return ICAL.Time.fromJSDate(date, true);
}

function applyInput(vevent: ICAL.Component, input: EventInput, includeRrule: boolean): void {
  vevent.updatePropertyWithValue("summary", input.title);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  if (input.description) {
    vevent.updatePropertyWithValue("description", input.description);
  } else {
    vevent.removeProperty("description");
  }
  if (input.location) {
    vevent.updatePropertyWithValue("location", input.location);
  } else {
    vevent.removeProperty("location");
  }
  vevent.removeAllProperties("dtstart");
  vevent.removeAllProperties("dtend");
  vevent.addPropertyWithValue("dtstart", icalDate(input.startAt, input.isAllDay));
  vevent.addPropertyWithValue("dtend", icalDate(input.endAt, input.isAllDay));
  if (includeRrule && input.rrule) {
    const body = input.rrule.replace(/^RRULE:/i, "");
    vevent.updatePropertyWithValue("rrule", ICAL.Recur.fromString(body));
  } else if (!includeRrule) {
    vevent.removeAllProperties("rrule");
  }
}

function bumpSequence(vevent: ICAL.Component): void {
  const raw = vevent.getFirstPropertyValue("sequence");
  const n =
    typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "0"), 10) || 0;
  vevent.updatePropertyWithValue("sequence", n + 1);
}

function newCalendar(): ICAL.Component {
  const vcalendar = new ICAL.Component("vcalendar");
  vcalendar.updatePropertyWithValue("prodid", PRODID);
  vcalendar.updatePropertyWithValue("version", "2.0");
  vcalendar.updatePropertyWithValue("calscale", "GREGORIAN");
  return vcalendar;
}

function toIcs(
  input: EventInput,
  uid: string,
  extra?: { recurrenceId?: Date | null },
): string {
  const vcalendar = newCalendar();
  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("sequence", 0);
  vevent.updatePropertyWithValue("status", "CONFIRMED");
  vevent.updatePropertyWithValue("transp", "OPAQUE");
  applyInput(vevent, input, !extra?.recurrenceId);
  if (extra?.recurrenceId) {
    vevent.updatePropertyWithValue(
      "recurrence-id",
      icalDate(extra.recurrenceId, input.isAllDay),
    );
  }
  vcalendar.addSubcomponent(vevent);
  return vcalendar.toString();
}

function untilBefore(splitAt: Date, isAllDay: boolean): Date {
  if (isAllDay) {
    return new Date(splitAt.getTime() - 24 * 60 * 60 * 1000);
  }
  return new Date(splitAt.getTime() - 1000);
}

function setUntil(vevent: ICAL.Component, until: Date, isAllDay: boolean): void {
  const raw = vevent.getFirstPropertyValue("rrule");
  const body = raw ? String(raw).replace(/^RRULE:/i, "") : "FREQ=DAILY";
  const recur = ICAL.Recur.fromString(body);
  recur.until = icalDate(until, isAllDay);
  vevent.updatePropertyWithValue("rrule", recur);
}

function splitAtForFollowing(
  event: { recurrenceId: Date | null },
  fallback?: Date,
): Date {
  const splitAt = event.recurrenceId ?? fallback;
  if (!splitAt) {
    throw new Error("CalDAV thisAndFollowing requires recurrenceId");
  }
  return splitAt;
}

function applySeriesUpdate(
  ics: string,
  input: EventInput,
  range: RecurrenceEdit,
  recurrenceId: Date | null,
): string {
  const vcalendar = parseCalendar(ics);
  if (range === "this" && recurrenceId) {
    let exception = exceptionVevent(vcalendar, recurrenceId);
    if (!exception) {
      exception = new ICAL.Component("vevent");
      const uid = masterVevent(vcalendar).getFirstPropertyValue("uid");
      if (typeof uid === "string") exception.updatePropertyWithValue("uid", uid);
      exception.updatePropertyWithValue(
        "recurrence-id",
        icalDate(recurrenceId, input.isAllDay),
      );
      vcalendar.addSubcomponent(exception);
    }
    applyInput(exception, input, false);
    bumpSequence(exception);
    return vcalendar.toString();
  }
  const master = masterVevent(vcalendar);
  applyInput(master, input, true);
  bumpSequence(master);
  return vcalendar.toString();
}

function applyThisDelete(ics: string, recurrenceId: Date, isAllDay: boolean): string {
  const vcalendar = parseCalendar(ics);
  const master = masterVevent(vcalendar);
  master.addPropertyWithValue("exdate", icalDate(recurrenceId, isAllDay));
  bumpSequence(master);
  return vcalendar.toString();
}

function mailtoEquals(value: string, username: string): boolean {
  const email = value.replace(/^mailto:/i, "").toLowerCase();
  return email === username.replace(/^mailto:/i, "").toLowerCase();
}

function setPartstat(ics: string, username: string, status: keyof typeof PARTSTAT): string {
  const vcalendar = parseCalendar(ics);
  const vevent = masterVevent(vcalendar);
  let found = false;
  for (const prop of vevent.getAllProperties("attendee")) {
    const value = String(prop.getFirstValue() ?? "");
    if (!mailtoEquals(value, username)) continue;
    prop.setParameter("partstat", PARTSTAT[status]);
    found = true;
  }
  if (!found) {
    throw new Error("CalDAV respond: authenticated user is not an attendee");
  }
  bumpSequence(vevent);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  return vcalendar.toString();
}

function headerEtag(res: { headers?: { get?: (name: string) => string | null } }): string | null {
  return res.headers?.get?.("etag") ?? res.headers?.get?.("ETag") ?? null;
}

async function getObject(
  client: CalDavClient,
  calendarUrl: string,
  href: string,
): Promise<{ url: string; etag: string | null; data: string }> {
  const objects = await client.fetchCalendarObjects({
    calendar: { url: collectionUrl(calendarUrl) },
    objectUrls: [href],
  });
  const obj = objects[0];
  const data = asText(obj?.data);
  if (!obj || !data) {
    throw new Error("CalDAV: event not found");
  }
  return { url: obj.url || href, etag: obj.etag ?? null, data };
}

async function writeResponse<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CalendarConflictError) throw err;
    throwIfConflict(err);
    if (httpStatus(err) != null) assertWriteOk(err);
    throw err;
  }
}

async function putObject(
  client: CalDavClient,
  object: { url: string; etag: string | null; data: string },
): Promise<{ etag: string | null; data: string; url: string }> {
  const res = await writeResponse(() =>
    client.updateCalendarObject({
      calendarObject: {
        url: object.url,
        etag: object.etag ?? undefined,
        data: object.data,
      },
    }),
  );
  assertWriteOk(res);
  return {
    url: object.url,
    data: object.data,
    etag: headerEtag(res) ?? object.etag,
  };
}

async function deleteObject(
  client: CalDavClient,
  object: { url: string; etag: string | null },
): Promise<void> {
  const res = await writeResponse(() =>
    client.deleteCalendarObject({
      calendarObject: {
        url: object.url,
        etag: object.etag ?? undefined,
      },
    }),
  );
  assertWriteOk(res);
}

async function pullSyncCollection(
  client: CalDavClient,
  calendarUrl: string,
  syncToken: string | null,
): Promise<PullResult> {
  let responses: DAVResponse[];
  try {
    responses = await client.syncCollection({
      url: calendarUrl,
      props: EVENT_PROPS,
      syncLevel: 1,
      syncToken: syncToken ?? "",
    });
  } catch (err) {
    throwIfSyncThrown(err);
    throw err;
  }
  classifySyncResponses(responses);
  const { upserts, deletedProviderIds, missingHrefs } = partitionResponses(
    responses,
    calendarUrl,
  );
  const extra = await fillMissing(client, calendarUrl, missingHrefs);
  return {
    upserts: [...upserts, ...extra],
    deletedProviderIds,
    cursor: syncTokenOf(responses),
    reset: false,
    complete: true,
  };
}

async function createOnCalendar(
  client: CalDavClient,
  calendarUrl: string,
  eventInput: EventInput,
): Promise<RemoteEvent> {
  const uid = randomUUID();
  const filename = `${uid}.ics`;
  const href = new URL(filename, collectionUrl(calendarUrl)).href;
  const ics = toIcs(eventInput, uid);
  const res = await writeResponse(() =>
    client.createCalendarObject({
      calendar: { url: collectionUrl(calendarUrl) },
      iCalString: ics,
      filename,
    }),
  );
  assertWriteOk(res);
  return mapCalDavEvent({
    href,
    etag: headerEtag(res),
    data: ics,
  });
}

function truncateIcs(ics: string, splitAt: Date): string {
  const vcalendar = parseCalendar(ics);
  const master = masterVevent(vcalendar);
  const isAllDay = Boolean(
    asIcalTime(master.getFirstPropertyValue("dtstart"))?.isDate,
  );
  setUntil(master, untilBefore(splitAt, isAllDay), isAllDay);
  bumpSequence(master);
  return vcalendar.toString();
}

async function pullCalendarQuery(
  client: CalDavClient,
  calendarUrl: string,
  reset: boolean,
): Promise<PullResult> {
  const { from, to } = instanceWindow(new Date());
  const responses = await client.calendarQuery({
    url: calendarUrl,
    props: EVENT_PROPS,
    filters: timeRangeFilter(from, to),
    depth: "1",
  });
  const { upserts, deletedProviderIds, missingHrefs } = partitionResponses(
    responses,
    calendarUrl,
  );
  const extra = await fillMissing(client, calendarUrl, missingHrefs);
  return {
    upserts: [...upserts, ...extra],
    deletedProviderIds,
    cursor: null,
    reset,
    complete: false,
  };
}

export function createCalDavAdapter(input: {
  url: string;
  username: string;
  password: string;
}): CalendarAdapter {
  let clientPromise: Promise<CalDavClient> | null = null;

  function getClient(): Promise<CalDavClient> {
    if (!clientPromise) {
      // tsdav follows /.well-known/caldav then calendar-home-set.
      clientPromise = createDAVClient({
        serverUrl: input.url,
        credentials: {
          username: input.username,
          password: input.password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
    }
    return clientPromise;
  }

  return {
    async listCalendars(): Promise<RemoteCalendar[]> {
      const client = await getClient();
      const calendars = await client.fetchCalendars();
      return calendars.map(mapCalendar);
    },

    async pull(
      calendar: { providerCalendarId: string; syncToken: string | null },
      cursor: string | null,
    ): Promise<PullResult> {
      const client = await getClient();
      const calendarUrl = calendar.providerCalendarId;
      const token = cursor ?? calendar.syncToken;
      try {
        return await pullSyncCollection(client, calendarUrl, token);
      } catch (err) {
        if (err instanceof CalDavSyncReportError && err.kind === "unsupported") {
          return pullCalendarQuery(client, calendarUrl, false);
        }
        if (
          err instanceof CalDavSyncReportError &&
          err.kind === "invalid-token" &&
          token
        ) {
          try {
            const result = await pullSyncCollection(client, calendarUrl, null);
            return { ...result, reset: true };
          } catch (retryErr) {
            if (
              retryErr instanceof CalDavSyncReportError &&
              retryErr.kind === "unsupported"
            ) {
              return pullCalendarQuery(client, calendarUrl, true);
            }
            throw retryErr;
          }
        }
        throw err;
      }
    },

    async createEvent(
      calendar: { providerCalendarId: string },
      eventInput: EventInput,
    ): Promise<RemoteEvent> {
      const client = await getClient();
      return createOnCalendar(client, calendar.providerCalendarId, eventInput);
    },

    async updateEvent(
      calendar: { providerCalendarId: string },
      event: {
        providerEventId: string;
        etag: string | null;
        recurrenceId: Date | null;
      },
      eventInput: EventInput,
      range: RecurrenceEdit,
    ): Promise<RemoteEvent> {
      const client = await getClient();
      const calendarUrl = calendar.providerCalendarId;
      const existing = await getObject(client, calendarUrl, event.providerEventId);
      const etag = event.etag ?? existing.etag;
      if (range === "thisAndFollowing") {
        const splitAt = splitAtForFollowing(event, eventInput.startAt);
        await putObject(client, {
          url: existing.url,
          etag,
          data: truncateIcs(existing.data, splitAt),
        });
        return createOnCalendar(client, calendarUrl, eventInput);
      }
      const ics = applySeriesUpdate(
        existing.data,
        eventInput,
        range,
        event.recurrenceId,
      );
      const written = await putObject(client, {
        url: existing.url,
        etag,
        data: ics,
      });
      return mapCalDavEvent({
        href: written.url,
        etag: written.etag,
        data: written.data,
      });
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
      const client = await getClient();
      const calendarUrl = calendar.providerCalendarId;
      if (range === "this" && event.recurrenceId) {
        const existing = await getObject(client, calendarUrl, event.providerEventId);
        const isAllDay = Boolean(
          asIcalTime(
            masterVevent(parseCalendar(existing.data)).getFirstPropertyValue("dtstart"),
          )?.isDate,
        );
        const ics = applyThisDelete(existing.data, event.recurrenceId, isAllDay);
        await putObject(client, {
          url: existing.url,
          etag: event.etag ?? existing.etag,
          data: ics,
        });
        return;
      }
      if (range === "thisAndFollowing") {
        const existing = await getObject(client, calendarUrl, event.providerEventId);
        const splitAt = splitAtForFollowing(event);
        await putObject(client, {
          url: existing.url,
          etag: event.etag ?? existing.etag,
          data: truncateIcs(existing.data, splitAt),
        });
        return;
      }
      await deleteObject(client, {
        url: event.providerEventId,
        etag: event.etag,
      });
    },

    async respond(
      calendar: { providerCalendarId: string },
      event: { providerEventId: string },
      status: "accepted" | "tentative" | "declined",
    ): Promise<RemoteEvent> {
      const client = await getClient();
      const existing = await getObject(
        client,
        calendar.providerCalendarId,
        event.providerEventId,
      );
      const ics = setPartstat(existing.data, input.username, status);
      const written = await putObject(client, {
        url: existing.url,
        etag: existing.etag,
        data: ics,
      });
      return mapCalDavEvent({
        href: written.url,
        etag: written.etag,
        data: written.data,
      });
    },
  };
}

export { CalendarConflictError };
