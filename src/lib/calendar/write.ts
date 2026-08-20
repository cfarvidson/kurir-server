import { Prisma, type CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
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

function adapterForAccount(account: AccountCreds): CalendarAdapter {
  if (account.provider === "GOOGLE") {
    if (!account.oauthAccessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createGoogleAdapter({
      accessToken: decrypt(account.oauthAccessToken),
    });
  }
  if (account.provider === "MICROSOFT") {
    if (!account.oauthAccessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createMicrosoftAdapter({
      accessToken: decrypt(account.oauthAccessToken),
    });
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

function isSeries(event: EventRow): boolean {
  return Boolean(
    event.rrule || event.rdate || event.masterEventId || event.recurrenceId,
  );
}

function adapterEventRef(
  event: EventRow,
  range: RecurrenceEdit,
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
    recurrenceId:
      event.recurrenceId ?? (needsOccurrence ? event.startAt : null),
  };
}

function isSeriesThis(event: EventRow, range: RecurrenceEdit): boolean {
  if (range !== "this") return false;
  return Boolean(
    event.rrule || event.rdate || event.masterEventId || event.recurrenceId,
  );
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
      await tx.calendarEvent.delete({
        where: { id: snapshot.createdEventId },
      });
      if (!snapshot.calendarVisible) {
        await tx.calendar.update({
          where: { id: snapshot.calendarId },
          data: { isVisible: false },
        });
      }
      return;
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

async function refreshAfterConflict(
  err: unknown,
  adapter: CalendarAdapter,
  calendar: CalendarRow,
  providerEventId: string | null,
): Promise<void> {
  if (!isConflict(err) || !providerEventId) return;
  const remote = await adapter.getEvent(
    { providerCalendarId: calendar.providerCalendarId },
    providerEventId,
  );
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

async function afterAdapterFailure(
  err: unknown,
  snapshot: Snapshot,
  adapter: CalendarAdapter,
  calendar: CalendarRow,
  providerEventId: string | null,
): Promise<never> {
  try {
    await restoreSnapshot(snapshot);
  } catch {
    // Prefer the provider error over a restore failure.
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

export async function createEventForUser(
  userId: string,
  calendarId: string,
  input: EventInput,
): Promise<{ id: string }> {
  const calendar = await loadCalendar(userId, calendarId);
  assertWritable(calendar);
  const adapter = adapterForAccount(calendar.account);
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
    const row = await tx.calendarEvent.create({
      data: {
        providerEventId: `pending:${crypto.randomUUID()}`,
        icalUid: null,
        etag: null,
        sequence: 0,
        ...inputFields(input),
        status: "confirmed",
        transparency: "busy",
        rdate: null,
        exdate: null,
        masterEventId: null,
        recurrenceId: null,
        organizerJson: Prisma.DbNull,
        attendeesJson: Prisma.DbNull,
        rawJson: Prisma.DbNull,
        calendarId: calendar.id,
        userId,
      },
    });
    snapshot.createdEventId = row.id;
    await rebuildInstances(tx, userId, calendar.id, row.id, now);
    return row;
  });

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

  const adapter = adapterForAccount(calendar.account);
  const now = new Date();
  const snapshot = await takeSnapshot(event, calendar);
  const ref = adapterEventRef(event, range);

  await db.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: event.id },
      data: {
        ...inputFields(input),
        ...(dest.id !== calendar.id ? { calendarId: dest.id } : {}),
      },
    });
    await rebuildInstances(tx, userId, dest.id, event.id, now);
  });

  try {
    let remote: RemoteEvent;
    if (dest.id !== calendar.id) {
      remote = await adapter.moveEvent(
        { providerCalendarId: calendar.providerCalendarId },
        { providerCalendarId: dest.providerCalendarId },
        { providerEventId: event.providerEventId, etag: event.etag },
      );
    } else {
      remote = await adapter.updateEvent(
        { providerCalendarId: calendar.providerCalendarId },
        ref,
        input,
        range,
      );
    }
    await db.$transaction(async (tx) => {
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
      event.providerEventId,
    );
  }
}

export async function deleteEventForUser(
  userId: string,
  eventId: string,
  range: RecurrenceEdit,
): Promise<void> {
  const loaded = await loadEvent(userId, eventId);
  const calendar = loaded.calendar as CalendarRow;
  assertWritable(calendar);
  const event = loaded as unknown as EventRow & { instances?: InstanceSnap[] };
  const adapter = adapterForAccount(calendar.account);
  const now = new Date();
  const snapshot = await takeSnapshot(event, calendar);
  const ref = adapterEventRef(event, range);

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

  try {
    await adapter.deleteEvent(
      { providerCalendarId: calendar.providerCalendarId },
      ref,
      range,
    );
  } catch (err) {
    await afterAdapterFailure(
      err,
      snapshot,
      adapter,
      calendar,
      event.providerEventId,
    );
  }
}
