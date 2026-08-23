import { Prisma, type CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { isDemoInstance } from "@/lib/demo";
import {
  CalendarOauthError,
  ensureAccessToken,
} from "@/lib/calendar/access-token";
import { applyPull } from "@/lib/calendar/apply-pull";
import {
  expandEventWindow,
  instanceWindow,
  type EventException,
  type EventMaster,
  type EventStatus,
  type Transparency,
} from "@/lib/calendar/expand";
import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";
import { createGoogleAdapter } from "@/lib/calendar/providers/google";
import { createMicrosoftAdapter } from "@/lib/calendar/providers/microsoft";
import {
  CalendarConflictError,
  type CalendarAdapter,
  type EventInput,
  type RecurrenceEdit,
  type RemoteEvent,
} from "@/lib/calendar/providers/types";

export { CalendarConflictError };

export class CalendarWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CalendarWriteError";
  }
}

type WriteTx = Pick<
  typeof db,
  "calendar" | "calendarEvent" | "calendarEventInstance" | "calendarTombstone"
>;

type AccountCreds = {
  id: string;
  provider: CalendarProvider;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthTokenExpiresAt: Date | null;
  caldavUrl: string | null;
  caldavUsername: string | null;
  encryptedPassword: string | null;
};

type CalendarRow = {
  id: string;
  providerCalendarId: string;
  isReadOnly: boolean;
  isVisible: boolean;
  accountId: string;
  userId: string;
  account: AccountCreds;
};

type EventRow = {
  id: string;
  providerEventId: string;
  icalUid: string | null;
  etag: string | null;
  sequence: number;
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
  masterEventId: string | null;
  recurrenceId: Date | null;
  organizerJson: unknown;
  attendeesJson: unknown;
  rawJson: unknown;
  calendarId: string;
  userId: string;
};

type InstanceSnap = {
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  eventId: string;
  calendarId: string;
  userId: string;
};

type Snapshot = {
  calendarId: string;
  calendarVisible: boolean;
  createdEventId: string | null;
  wroteTombstone: boolean;
  event: EventRow | null;
  exceptions: EventRow[];
  instances: InstanceSnap[];
};

function asJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function providerLabel(provider: CalendarProvider): string {
  if (provider === "GOOGLE") return "Google";
  if (provider === "MICROSOFT") return "Outlook";
  return "this calendar";
}

function isHttp412(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  return Number(rec.response?.status ?? rec.status ?? rec.code) === 412;
}

function isConflict(err: unknown): boolean {
  return err instanceof CalendarConflictError || isHttp412(err);
}

function adapterForAccount(
  account: AccountCreds,
  accessToken: string | null,
): CalendarAdapter {
  if (account.provider === "GOOGLE") {
    if (!accessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createGoogleAdapter({ accessToken });
  }
  if (account.provider === "MICROSOFT") {
    if (!accessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createMicrosoftAdapter({ accessToken });
  }
  if (!account.caldavUrl || !account.caldavUsername || !account.encryptedPassword) {
    throw new CalendarWriteError("Missing CalDAV credentials", 500);
  }
  return createCalDavAdapter({
    url: account.caldavUrl,
    username: account.caldavUsername,
    password: decrypt(account.encryptedPassword),
  });
}

async function adapterForWritable(
  account: AccountCreds,
): Promise<CalendarAdapter> {
  try {
    const accessToken = await ensureAccessToken(account);
    return adapterForAccount(account, accessToken);
  } catch (err) {
    if (err instanceof CalendarOauthError) {
      throw new CalendarWriteError(err.message, 401);
    }
    throw err;
  }
}

function assertWritable(calendar: { isReadOnly: boolean }): void {
  if (calendar.isReadOnly) {
    throw new CalendarWriteError("Calendar is read-only", 403);
  }
}

function inputFields(input: EventInput) {
  return {
    title: input.title,
    description: input.description,
    location: input.location,
    startAt: input.startAt,
    endAt: input.endAt,
    isAllDay: input.isAllDay,
    timezone: input.timezone,
    rrule: input.rrule,
  };
}

function replicaFields(
  event: RemoteEvent,
  userId: string,
  calendarId: string,
  masterEventId: string | null,
) {
  return {
    providerEventId: event.providerEventId,
    icalUid: event.icalUid,
    etag: event.etag,
    sequence: event.sequence,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    timezone: event.timezone,
    status: event.status,
    transparency: event.transparency,
    rrule: event.rrule,
    rdate: event.rdate,
    exdate: event.exdate,
    masterEventId,
    recurrenceId: event.recurrenceId,
    organizerJson: asJson(event.organizerJson),
    attendeesJson: asJson(event.attendeesJson),
    rawJson: asJson(event.rawJson),
    calendarId,
    userId,
  };
}

function persistable(event: EventRow) {
  return {
    providerEventId: event.providerEventId,
    icalUid: event.icalUid,
    etag: event.etag,
    sequence: event.sequence,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    timezone: event.timezone,
    status: event.status,
    transparency: event.transparency,
    rrule: event.rrule,
    rdate: event.rdate,
    exdate: event.exdate,
    masterEventId: event.masterEventId,
    recurrenceId: event.recurrenceId,
    organizerJson: asJson(event.organizerJson),
    attendeesJson: asJson(event.attendeesJson),
    rawJson: asJson(event.rawJson),
    calendarId: event.calendarId,
    userId: event.userId,
  };
}

function cloneEvent(event: EventRow): EventRow {
  return {
    id: event.id,
    providerEventId: event.providerEventId,
    icalUid: event.icalUid,
    etag: event.etag,
    sequence: event.sequence,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: new Date(event.startAt),
    endAt: new Date(event.endAt),
    isAllDay: event.isAllDay,
    timezone: event.timezone,
    status: event.status,
    transparency: event.transparency,
    rrule: event.rrule,
    rdate: event.rdate,
    exdate: event.exdate,
    masterEventId: event.masterEventId,
    recurrenceId: event.recurrenceId ? new Date(event.recurrenceId) : null,
    organizerJson: event.organizerJson,
    attendeesJson: event.attendeesJson,
    rawJson: event.rawJson,
    calendarId: event.calendarId,
    userId: event.userId,
  };
}

function toEventMaster(row: EventRow): EventMaster {
  const transparency: Transparency =
    row.transparency === "free" ? "free" : "busy";
  const status: EventStatus =
    row.status === "cancelled" || row.status === "tentative"
      ? row.status
      : "confirmed";
  return {
    id: row.id,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    rrule: row.rrule,
    rdate: row.rdate,
    exdate: row.exdate,
    transparency,
    status,
  };
}

function toExceptions(
  masterId: string,
  rows: Array<{
    recurrenceId: Date | null;
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    status: string;
    title: string;
  }>,
): EventException[] {
  const out: EventException[] = [];
  for (const row of rows) {
    if (row.recurrenceId == null) continue;
    out.push({
      masterEventId: masterId,
      recurrenceId: row.recurrenceId,
      startAt: row.startAt,
      endAt: row.endAt,
      isAllDay: row.isAllDay,
      isCancelled: row.status === "cancelled",
      title: row.title,
    });
  }
  return out;
}

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function appendExdate(existing: string | null, occurrence: Date): string {
  const stamp = compactUtc(occurrence);
  if (!existing) return stamp;
  const parts = existing
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.includes(stamp)) return existing;
  return [...parts, stamp].join(",");
}

function targetCalendarId(input: EventInput): string | undefined {
  if (!("calendarId" in input)) return undefined;
  const value = (input as EventInput & { calendarId?: unknown }).calendarId;
  return typeof value === "string" ? value : undefined;
}

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function isPureMove(event: EventRow, input: EventInput): boolean {
  return (
    event.title === input.title &&
    event.description === input.description &&
    event.location === input.location &&
    sameInstant(event.startAt, input.startAt) &&
    sameInstant(event.endAt, input.endAt) &&
    event.isAllDay === input.isAllDay &&
    event.timezone === input.timezone &&
    event.rrule === input.rrule
  );
}

function isSeries(event: EventRow): boolean {
  return Boolean(
    event.rrule || event.rdate || event.masterEventId || event.recurrenceId,
  );
}

/// The client only ever knows an occurrence by its current start. If an
/// earlier "this" edit already moved that occurrence, an exception row
/// sits at the new start but still carries the original slot as its own
/// recurrenceId - the instant the RRULE actually generates and the one
/// EXDATE or a further split must act on. Resolve to that original slot
/// when a moved occurrence is named; an unmoved occurrence's start already
/// is its recurrence id, so it passes through unchanged.
function resolveOccurrence(
  event: EventRow & { exceptions?: EventRow[] },
  occurrence: Date | null | undefined,
): Date | null | undefined {
  if (!occurrence) return occurrence;
  const moved = (event.exceptions ?? []).find(
    (ex) => ex.startAt.getTime() === occurrence.getTime(),
  );
  return moved?.recurrenceId ?? occurrence;
}

function adapterEventRef(
  event: EventRow,
  range: RecurrenceEdit,
  occurrence?: Date | null,
): {
  providerEventId: string;
  etag: string | null;
  recurrenceId: Date | null;
} {
  const needsOccurrence =
    (range === "this" || range === "thisAndFollowing") && isSeries(event);
  return {
    providerEventId: event.providerEventId,
    etag: event.etag,
    // The caller names the occurrence. Falling back to the master's own
    // start is what every caller did before the mobile contract carried
    // the field, and it is what the web still relies on - but for any
    // occurrence other than the first it silently acts on the wrong one.
    recurrenceId:
      event.recurrenceId ??
      (needsOccurrence ? (occurrence ?? event.startAt) : null),
  };
}

function isSeriesThis(event: EventRow, range: RecurrenceEdit): boolean {
  if (range !== "this") return false;
  return isSeries(event);
}

function isSeriesFollowing(event: EventRow, range: RecurrenceEdit): boolean {
  return range === "thisAndFollowing" && isSeries(event);
}

function masterRowId(event: EventRow): string {
  return event.masterEventId ?? event.id;
}

function occurrenceId(
  event: EventRow,
  range: RecurrenceEdit,
  occurrence?: Date | null,
): Date | null {
  if (event.recurrenceId) return event.recurrenceId;
  if (range === "this" || range === "thisAndFollowing") {
    return isSeries(event) ? (occurrence ?? event.startAt) : null;
  }
  return null;
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rruleWithUntil(rrule: string | null, until: string): string {
  const raw = (rrule ?? "FREQ=DAILY").replace(/^RRULE:/i, "");
  const parts = raw.split(";").filter((part) => {
    const key = part.split("=")[0]?.toUpperCase();
    return key !== "UNTIL" && key !== "COUNT" && part.length > 0;
  });
  parts.push(`UNTIL=${until}`);
  return parts.join(";");
}

function truncateRrule(
  rrule: string | null,
  splitAt: Date,
  isAllDay: boolean,
): string {
  const until = isAllDay
    ? ymdUtc(new Date(splitAt.getTime() - 24 * 60 * 60 * 1000)).replace(
        /-/g,
        "",
      )
    : compactUtc(new Date(splitAt.getTime() - 1000));
  return rruleWithUntil(rrule, until);
}

async function loadCalendar(
  userId: string,
  calendarId: string,
): Promise<CalendarRow> {
  const row = await db.calendar.findFirst({
    where: { id: calendarId, userId },
    include: { account: true },
  });
  if (!row) throw new CalendarWriteError("Calendar not found", 404);
  return row;
}

async function loadEvent(userId: string, eventId: string) {
  const row = await db.calendarEvent.findFirst({
    where: { id: eventId, userId },
    include: {
      calendar: { include: { account: true } },
      exceptions: true,
      instances: true,
    },
  });
  if (!row?.calendar) throw new CalendarWriteError("Event not found", 404);
  return row;
}

function cloneInstance(row: InstanceSnap): InstanceSnap {
  return {
    startAt: new Date(row.startAt),
    endAt: new Date(row.endAt),
    isAllDay: row.isAllDay,
    isCancelled: row.isCancelled,
    isException: row.isException,
    eventId: row.eventId,
    calendarId: row.calendarId,
    userId: row.userId,
  };
}

async function takeSnapshot(
  event: EventRow,
  calendar: CalendarRow,
): Promise<Snapshot> {
  const masterId = event.masterEventId ?? event.id;
  const exceptions = (
    (await db.calendarEvent.findMany({
      where: { userId: event.userId, masterEventId: masterId },
    })) as EventRow[]
  ).map(cloneEvent);
  const instanceEventIds = [...new Set([event.id, masterId])];
  const instances = (
    (await db.calendarEventInstance.findMany({
      where: {
        userId: event.userId,
        eventId: { in: instanceEventIds },
      },
    })) as InstanceSnap[]
  ).map(cloneInstance);
  return {
    calendarId: calendar.id,
    calendarVisible: calendar.isVisible,
    createdEventId: null,
    wroteTombstone: false,
    event: cloneEvent(event),
    exceptions,
    instances,
  };
}

async function rebuildInstances(
  tx: WriteTx,
  userId: string,
  calendarId: string,
  masterId: string,
  now: Date,
): Promise<void> {
  await tx.calendarEventInstance.deleteMany({
    where: { userId, eventId: masterId },
  });
  const master = await tx.calendarEvent.findFirst({
    where: { id: masterId, userId },
  });
  if (!master) return;
  const exceptions = await tx.calendarEvent.findMany({
    where: { userId, masterEventId: masterId },
  });
  const { from, to } = instanceWindow(now);
  const rows = expandEventWindow(
    toEventMaster(master as EventRow),
    toExceptions(masterId, exceptions as EventRow[]),
    from,
    to,
  );
  if (rows.length === 0) return;
  await tx.calendarEventInstance.createMany({
    data: rows.map((row) => ({
      startAt: row.startAt,
      endAt: row.endAt,
      isAllDay: row.isAllDay,
      isCancelled: row.isCancelled,
      isException: row.isException,
      eventId: row.eventId,
      calendarId,
      userId,
    })),
  });
}

async function restoreEventRow(tx: WriteTx, event: EventRow): Promise<void> {
  const existing = await tx.calendarEvent.findFirst({
    where: { id: event.id, userId: event.userId },
  });
  const data = persistable(event);
  if (existing) {
    await tx.calendarEvent.update({ where: { id: event.id }, data });
    return;
  }
  await tx.calendarEvent.create({ data: { id: event.id, ...data } });
}

async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  await db.$transaction(async (tx) => {
    if (snapshot.createdEventId) {
      await tx.calendarEvent.deleteMany({
        where: { id: snapshot.createdEventId },
      });
      if (!snapshot.calendarVisible) {
        await tx.calendar.update({
          where: { id: snapshot.calendarId },
          data: { isVisible: false },
        });
      }
    }

    const event = snapshot.event;
    if (!event) return;

    await restoreEventRow(tx, event);
    for (const ex of snapshot.exceptions) {
      if (ex.id === event.id) continue;
      await restoreEventRow(tx, ex);
    }

    const instanceEventIds = [
      ...new Set(
        [event.id, event.masterEventId, ...snapshot.exceptions.map((row) => row.id)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    await tx.calendarEventInstance.deleteMany({
      where: { userId: event.userId, eventId: { in: instanceEventIds } },
    });
    if (snapshot.instances.length > 0) {
      await tx.calendarEventInstance.createMany({
        data: snapshot.instances,
      });
    }

    if (snapshot.wroteTombstone) {
      await tx.calendarTombstone.deleteMany({
        where: { eventId: event.id, userId: event.userId },
      });
    }
  });
}

async function applyRemoteEvent(
  calendar: CalendarRow,
  remote: RemoteEvent,
): Promise<void> {
  await applyPull({
    userId: calendar.userId,
    accountId: calendar.accountId,
    calendarId: calendar.id,
    now: new Date(),
    pull: {
      upserts: [remote],
      deletedProviderIds: [],
      cursor: null,
      reset: false,
      complete: false,
    },
  });
}

async function refetchSeries(
  adapter: CalendarAdapter,
  calendar: CalendarRow,
  providerEventId: string,
): Promise<boolean> {
  try {
    const remote = await adapter.getEvent(
      { providerCalendarId: calendar.providerCalendarId },
      providerEventId,
    );
    await applyRemoteEvent(calendar, remote);
    return true;
  } catch {
    return false;
  }
}

async function refreshAfterConflict(
  err: unknown,
  adapter: CalendarAdapter,
  calendar: CalendarRow,
  providerEventId: string | null,
): Promise<void> {
  if (!isConflict(err) || !providerEventId) return;
  await refetchSeries(adapter, calendar, providerEventId);
}

async function afterAdapterFailure(
  err: unknown,
  snapshot: Snapshot,
  adapter: CalendarAdapter,
  calendar: CalendarRow,
  providerEventId: string | null,
  opts?: { refetchSeries?: boolean },
): Promise<never> {
  let refetched = false;
  if (opts?.refetchSeries && providerEventId) {
    if (snapshot.createdEventId) {
      try {
        await db.calendarEvent.deleteMany({
          where: { id: snapshot.createdEventId },
        });
      } catch {
        // Continue to refetch the truncated provider series.
      }
    }
    refetched = await refetchSeries(adapter, calendar, providerEventId);
  }
  if (!refetched) {
    try {
      await restoreSnapshot(snapshot);
    } catch {
      // Prefer the provider error over a restore failure.
    }
  }
  if (isConflict(err)) {
    try {
      await refreshAfterConflict(err, adapter, calendar, providerEventId);
    } catch {
      // Conflict toast still wins if the single-event refresh fails.
    }
    throw new CalendarConflictError(providerLabel(calendar.account.provider));
  }
  throw err;
}

async function persistThisException(
  tx: WriteTx,
  event: EventRow,
  remote: RemoteEvent,
  userId: string,
  calendarId: string,
  now: Date,
  createdEventId: string | null,
  occurrence: Date | null,
): Promise<void> {
  const masterId = masterRowId(event);
  const data = {
    ...replicaFields(remote, userId, calendarId, masterId),
    // The adapter's own recurrenceId wins when it has one (Google,
    // Microsoft). CalDAV echoes back the master with none, so without the
    // caller's occurrence here this fell back straight to the master's own
    // start - the pre-adapter transaction had just stamped the right value
    // on this same row, and this overwrote it with the wrong one.
    recurrenceId:
      remote.recurrenceId ?? event.recurrenceId ?? occurrence ?? event.startAt,
  };
  const targetId = event.masterEventId ? event.id : createdEventId;
  if (targetId) {
    await tx.calendarEvent.update({
      where: { id: targetId },
      data,
    });
  } else {
    await tx.calendarEvent.create({ data });
  }
  await rebuildInstances(tx, userId, calendarId, masterId, now);
}

async function persistFollowingSplit(
  tx: WriteTx,
  event: EventRow,
  remote: RemoteEvent,
  userId: string,
  calendarId: string,
  now: Date,
  createdEventId: string | null,
  truncated: RemoteEvent | null,
): Promise<void> {
  const masterId = masterRowId(event);
  if (truncated) {
    await tx.calendarEvent.update({
      where: { id: masterId },
      data: replicaFields(truncated, userId, calendarId, null),
    });
  }
  const newFields = replicaFields(remote, userId, calendarId, null);
  let newId = createdEventId;
  if (newId) {
    await tx.calendarEvent.update({
      where: { id: newId },
      data: newFields,
    });
  } else {
    const created = await tx.calendarEvent.create({ data: newFields });
    newId = created.id;
  }
  await rebuildInstances(tx, userId, calendarId, masterId, now);
  if (newId) await rebuildInstances(tx, userId, calendarId, newId, now);
}

async function createReplicaRow(
  tx: WriteTx,
  userId: string,
  calendar: CalendarRow,
  input: EventInput,
  extra?: {
    providerEventId?: string;
    masterEventId?: string | null;
    recurrenceId?: Date | null;
    rrule?: string | null;
  },
): Promise<EventRow> {
  return tx.calendarEvent.create({
    data: {
      providerEventId: extra?.providerEventId ?? `pending:${crypto.randomUUID()}`,
      icalUid: input.icalUid ?? null,
      etag: null,
      sequence: 0,
      ...inputFields(input),
      ...(extra?.rrule !== undefined ? { rrule: extra.rrule } : {}),
      status: "confirmed",
      transparency: "busy",
      rdate: null,
      exdate: null,
      masterEventId: extra?.masterEventId ?? null,
      recurrenceId: extra?.recurrenceId ?? null,
      organizerJson: asJson(input.organizer),
      attendeesJson: asJson(input.attendees),
      rawJson: Prisma.DbNull,
      calendarId: calendar.id,
      userId,
    },
  }) as Promise<EventRow>;
}

export async function createEventForUser(
  userId: string,
  calendarId: string,
  input: EventInput,
): Promise<{ id: string }> {
  const calendar = await loadCalendar(userId, calendarId);
  assertWritable(calendar);
  const now = new Date();
  const snapshot: Snapshot = {
    calendarId: calendar.id,
    calendarVisible: calendar.isVisible,
    createdEventId: null,
    wroteTombstone: false,
    event: null,
    exceptions: [],
    instances: [],
  };

  const created = await db.$transaction(async (tx) => {
    if (!calendar.isVisible) {
      await tx.calendar.update({
        where: { id: calendar.id },
        data: { isVisible: true },
      });
    }
    const row = await createReplicaRow(tx, userId, calendar, input);
    snapshot.createdEventId = row.id;
    await rebuildInstances(tx, userId, calendar.id, row.id, now);
    return row;
  });

  if (isDemoInstance()) return { id: created.id };

  const adapter = await adapterForWritable(calendar.account);
  try {
    const remote = await adapter.createEvent(
      { providerCalendarId: calendar.providerCalendarId },
      input,
    );
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: created.id },
        data: replicaFields(remote, userId, calendar.id, null),
      });
      await rebuildInstances(tx, userId, calendar.id, created.id, now);
    });
    return { id: created.id };
  } catch (err) {
    return afterAdapterFailure(err, snapshot, adapter, calendar, null);
  }
}

export async function updateEventForUser(
  userId: string,
  eventId: string,
  input: EventInput & { calendarId?: string },
  range: RecurrenceEdit,
  occurrence?: Date | null,
): Promise<void> {
  const loaded = await loadEvent(userId, eventId);
  const calendar = loaded.calendar as CalendarRow;
  assertWritable(calendar);
  const event = loaded as unknown as EventRow & {
    instances?: InstanceSnap[];
    exceptions?: EventRow[];
  };

  const destId = targetCalendarId(input);
  let dest = calendar;
  if (destId && destId !== calendar.id) {
    dest = await loadCalendar(userId, destId);
    if (dest.accountId !== calendar.accountId) {
      throw new CalendarWriteError("Cannot move events across accounts", 400);
    }
    assertWritable(dest);
  }

  const now = new Date();
  const snapshot = await takeSnapshot(event, calendar);
  const resolvedOccurrence = resolveOccurrence(event, occurrence);
  const ref = adapterEventRef(event, range, resolvedOccurrence);
  const masterId = masterRowId(event);
  const splitAt = occurrenceId(event, range, resolvedOccurrence);
  const masterForSplit = event.masterEventId
    ? ((await db.calendarEvent.findFirst({
        where: { id: masterId, userId },
      })) as EventRow | null)
    : event;

  await db.$transaction(async (tx) => {
    if (isSeriesThis(event, range) && splitAt) {
      if (event.masterEventId) {
        await tx.calendarEvent.update({
          where: { id: event.id },
          data: {
            ...inputFields(input),
            recurrenceId: splitAt,
            ...(dest.id !== calendar.id ? { calendarId: dest.id } : {}),
          },
        });
      } else {
        const row = await createReplicaRow(tx, userId, dest, input, {
          masterEventId: masterId,
          recurrenceId: splitAt,
          rrule: null,
        });
        snapshot.createdEventId = row.id;
      }
      await rebuildInstances(tx, userId, dest.id, masterId, now);
      return;
    }

    if (isSeriesFollowing(event, range) && splitAt) {
      await tx.calendarEvent.update({
        where: { id: masterId },
        data: {
          rrule: truncateRrule(
            masterForSplit?.rrule ?? event.rrule,
            splitAt,
            masterForSplit?.isAllDay ?? event.isAllDay,
          ),
        },
      });
      const row = await createReplicaRow(tx, userId, dest, input);
      snapshot.createdEventId = row.id;
      await rebuildInstances(tx, userId, dest.id, masterId, now);
      await rebuildInstances(tx, userId, dest.id, row.id, now);
      return;
    }

    await tx.calendarEvent.update({
      where: { id: event.id },
      data: {
        ...inputFields(input),
        ...(dest.id !== calendar.id ? { calendarId: dest.id } : {}),
      },
    });
    await rebuildInstances(tx, userId, dest.id, event.id, now);
  });

  if (isDemoInstance()) return;

  const adapter = await adapterForWritable(calendar.account);
  try {
    let remote: RemoteEvent;
    if (dest.id !== calendar.id) {
      remote = await adapter.moveEvent(
        { providerCalendarId: calendar.providerCalendarId },
        { providerCalendarId: dest.providerCalendarId },
        { providerEventId: event.providerEventId, etag: event.etag },
      );
      if (!isPureMove(event, input)) {
        remote = await adapter.updateEvent(
          { providerCalendarId: dest.providerCalendarId },
          {
            providerEventId: remote.providerEventId,
            etag: remote.etag,
            recurrenceId: ref.recurrenceId,
          },
          input,
          range,
        );
      }
    } else {
      remote = await adapter.updateEvent(
        { providerCalendarId: calendar.providerCalendarId },
        ref,
        input,
        range,
      );
    }

    let truncated: RemoteEvent | null = null;
    if (isSeriesFollowing(event, range)) {
      try {
        truncated = await adapter.getEvent(
          { providerCalendarId: dest.providerCalendarId },
          await masterProviderIdOf(event),
        );
      } catch {
        truncated = null;
      }
    }

    await db.$transaction(async (tx) => {
      if (isSeriesThis(event, range) && splitAt) {
        await persistThisException(
          tx,
          event,
          remote,
          userId,
          dest.id,
          now,
          snapshot.createdEventId,
          splitAt,
        );
        return;
      }
      if (isSeriesFollowing(event, range)) {
        await persistFollowingSplit(
          tx,
          event,
          remote,
          userId,
          dest.id,
          now,
          snapshot.createdEventId,
          truncated,
        );
        return;
      }
      await tx.calendarEvent.update({
        where: { id: event.id },
        data: replicaFields(remote, userId, dest.id, event.masterEventId),
      });
      await rebuildInstances(tx, userId, dest.id, event.id, now);
    });
  } catch (err) {
    await afterAdapterFailure(
      err,
      snapshot,
      adapter,
      calendar,
      isSeriesFollowing(event, range)
        ? await masterProviderIdOf(event)
        : event.providerEventId,
      { refetchSeries: isSeriesFollowing(event, range) },
    );
  }
}

async function masterProviderIdOf(event: EventRow): Promise<string> {
  if (!event.masterEventId) return event.providerEventId;
  const master = await db.calendarEvent.findFirst({
    where: { id: event.masterEventId, userId: event.userId },
  });
  return master?.providerEventId ?? event.providerEventId;
}

export async function deleteEventForUser(
  userId: string,
  eventId: string,
  range: RecurrenceEdit,
  occurrence?: Date | null,
): Promise<void> {
  const loaded = await loadEvent(userId, eventId);
  const calendar = loaded.calendar as CalendarRow;
  assertWritable(calendar);
  const event = loaded as unknown as EventRow & {
    instances?: InstanceSnap[];
    exceptions?: EventRow[];
  };
  const now = new Date();
  const snapshot = await takeSnapshot(event, calendar);
  const resolvedOccurrence = resolveOccurrence(event, occurrence);
  const ref = adapterEventRef(event, range, resolvedOccurrence);
  const masterId = masterRowId(event);
  const splitAt = occurrenceId(event, range, resolvedOccurrence);

  if (isSeriesThis(event, range) && !event.masterEventId) {
    const occurrence = ref.recurrenceId ?? event.startAt;
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: event.id },
        data: { exdate: appendExdate(event.exdate, occurrence) },
      });
      await rebuildInstances(tx, userId, calendar.id, event.id, now);
    });
  } else if (isSeriesThis(event, range) && event.masterEventId) {
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: event.id },
        data: { status: "cancelled" },
      });
      await rebuildInstances(tx, userId, calendar.id, event.masterEventId!, now);
    });
  } else if (isSeriesFollowing(event, range) && splitAt) {
    const master = event.masterEventId
      ? await db.calendarEvent.findFirst({
          where: { id: masterId, userId },
        })
      : event;
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: masterId },
        data: {
          rrule: truncateRrule(
            (master as EventRow | null)?.rrule ?? event.rrule,
            splitAt,
            (master as EventRow | null)?.isAllDay ?? event.isAllDay,
          ),
        },
      });
      await rebuildInstances(tx, userId, calendar.id, masterId, now);
    });
  } else {
    snapshot.wroteTombstone = !event.masterEventId && event.recurrenceId == null;
    await db.$transaction(async (tx) => {
      if (snapshot.wroteTombstone) {
        await tx.calendarTombstone.createMany({
          data: [
            {
              eventId: event.id,
              providerEventId: event.providerEventId,
              userId,
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.calendarEvent.delete({ where: { id: event.id } });
    });
  }

  if (isDemoInstance()) return;

  const adapter = await adapterForWritable(calendar.account);
  try {
    await adapter.deleteEvent(
      { providerCalendarId: calendar.providerCalendarId },
      ref,
      range,
    );
    if (isSeriesFollowing(event, range)) {
      const truncated = await adapter.getEvent(
        { providerCalendarId: calendar.providerCalendarId },
        await masterProviderIdOf(event),
      );
      await db.$transaction(async (tx) => {
        await tx.calendarEvent.update({
          where: { id: masterId },
          data: replicaFields(truncated, userId, calendar.id, null),
        });
        await rebuildInstances(tx, userId, calendar.id, masterId, now);
      });
    }
  } catch (err) {
    await afterAdapterFailure(
      err,
      snapshot,
      adapter,
      calendar,
      await masterProviderIdOf(event),
      { refetchSeries: isSeriesFollowing(event, range) },
    );
  }
}
