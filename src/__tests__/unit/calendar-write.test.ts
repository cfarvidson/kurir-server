import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarConflictError } from "@/lib/calendar/providers/types";
import type { EventInput, RemoteEvent } from "@/lib/calendar/providers/types";

const { adapter } = vi.hoisted(() => {
  const adapter = {
    listCalendars: vi.fn(),
    pull: vi.fn(),
    getEvent: vi.fn(),
    moveEvent: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    respond: vi.fn(),
  };
  return { adapter };
});

type CalendarRow = {
  id: string;
  providerCalendarId: string;
  name: string;
  isVisible: boolean;
  isPrimary: boolean;
  isReadOnly: boolean;
  timezone: string | null;
  syncToken: string | null;
  accountId: string;
  userId: string;
  account: AccountRow;
};

type AccountRow = {
  id: string;
  provider: "GOOGLE" | "MICROSOFT" | "CALDAV";
  oauthAccessToken: string | null;
  caldavUrl: string | null;
  caldavUsername: string | null;
  encryptedPassword: string | null;
  userId: string;
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

type InstanceRow = {
  id?: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  eventId: string;
  calendarId: string;
  userId: string;
};

type TombstoneRow = {
  eventId: string;
  providerEventId: string;
  userId: string;
};

const store: {
  calendars: CalendarRow[];
  events: EventRow[];
  instances: InstanceRow[];
  tombstones: TombstoneRow[];
  seq: number;
} = {
  calendars: [],
  events: [],
  instances: [],
  tombstones: [],
  seq: 0,
};

function whereMatch(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value == null) continue;
    if (
      typeof value === "object" &&
      value !== null &&
      "in" in value &&
      Array.isArray((value as { in: unknown[] }).in)
    ) {
      if (!(value as { in: unknown[] }).in.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

vi.mock("@/lib/db", () => {
  const calendar = {
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const calendarEvent = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const calendarEventInstance = {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const calendarTombstone = {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  const tx = {
    calendar,
    calendarEvent,
    calendarEventInstance,
    calendarTombstone,
  };
  return {
    db: {
      ...tx,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("@/lib/calendar/providers/google", () => ({
  createGoogleAdapter: vi.fn(() => adapter),
}));

import { db } from "@/lib/db";

function account(partial: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acc-1",
    provider: "GOOGLE",
    oauthAccessToken: "tok-1",
    caldavUrl: null,
    caldavUsername: null,
    encryptedPassword: null,
    userId: "u1",
    ...partial,
  };
}

function calendar(partial: Partial<CalendarRow> = {}): CalendarRow {
  const acc = partial.account ?? account();
  return {
    id: "cal-1",
    providerCalendarId: "primary",
    name: "Personal",
    isVisible: true,
    isPrimary: true,
    isReadOnly: false,
    timezone: "UTC",
    syncToken: "sync-1",
    accountId: acc.id,
    userId: "u1",
    account: acc,
    ...partial,
  };
}

function eventRow(partial: Partial<EventRow> = {}): EventRow {
  return {
    id: "evt-1",
    providerEventId: "g-1",
    icalUid: "uid-1",
    etag: "etag-old",
    sequence: 0,
    title: "Standup",
    description: null,
    location: null,
    startAt: new Date("2026-08-20T10:00:00.000Z"),
    endAt: new Date("2026-08-20T11:00:00.000Z"),
    isAllDay: false,
    timezone: "UTC",
    status: "confirmed",
    transparency: "busy",
    rrule: null,
    rdate: null,
    exdate: null,
    masterEventId: null,
    recurrenceId: null,
    organizerJson: null,
    attendeesJson: null,
    rawJson: null,
    calendarId: "cal-1",
    userId: "u1",
    ...partial,
  };
}

function input(partial: Partial<EventInput> = {}): EventInput {
  return {
    title: "Lunch",
    description: null,
    location: null,
    startAt: new Date("2026-08-20T12:00:00.000Z"),
    endAt: new Date("2026-08-20T13:00:00.000Z"),
    isAllDay: false,
    timezone: "UTC",
    rrule: null,
    ...partial,
  };
}

function remote(partial: Partial<RemoteEvent> = {}): RemoteEvent {
  return {
    providerEventId: "g-created",
    icalUid: "uid-created",
    etag: "etag-new",
    sequence: 0,
    title: "Lunch",
    description: null,
    location: null,
    startAt: new Date("2026-08-20T12:00:00.000Z"),
    endAt: new Date("2026-08-20T13:00:00.000Z"),
    isAllDay: false,
    timezone: "UTC",
    status: "confirmed",
    transparency: "busy",
    rrule: null,
    rdate: null,
    exdate: null,
    masterProviderEventId: null,
    recurrenceId: null,
    organizerJson: null,
    attendeesJson: null,
    rawJson: { id: "g-created" },
    ...partial,
  };
}

function wireStore() {
  vi.mocked(db.calendar.findFirst).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    const row = store.calendars.find((c) =>
      whereMatch(c as unknown as Record<string, unknown>, where),
    );
    return (row ?? null) as never;
  });
  vi.mocked(db.calendar.update).mockImplementation(async (args) => {
    const id = (args as { where: { id: string } }).where.id;
    const data = (args as { data: Partial<CalendarRow> }).data;
    const row = store.calendars.find((c) => c.id === id);
    if (!row) throw new Error("calendar not found");
    Object.assign(row, data);
    return row as never;
  });

  vi.mocked(db.calendarEvent.findFirst).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    const include = (args as { include?: Record<string, unknown> }).include;
    const row = store.events.find((e) =>
      whereMatch(e as unknown as Record<string, unknown>, where),
    );
    if (!row) return null as never;
    const result: Record<string, unknown> = { ...row };
    if (include?.calendar) {
      result.calendar = store.calendars.find((c) => c.id === row.calendarId);
    }
    if (include?.exceptions) {
      result.exceptions = store.events.filter((e) => e.masterEventId === row.id);
    }
    if (include?.instances) {
      result.instances = store.instances.filter((i) => i.eventId === row.id);
    }
    return result as never;
  });
  vi.mocked(db.calendarEvent.findMany).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    return store.events.filter((e) =>
      whereMatch(e as unknown as Record<string, unknown>, where),
    ) as never;
  });
  vi.mocked(db.calendarEvent.create).mockImplementation(async (args) => {
    const data = (args as { data: Partial<EventRow> }).data;
    const row = eventRow({
      ...data,
      id: data.id ?? `evt-${++store.seq}`,
    } as EventRow);
    store.events.push(row);
    return row as never;
  });
  vi.mocked(db.calendarEvent.update).mockImplementation(async (args) => {
    const id = (args as { where: { id: string } }).where.id;
    const data = (args as { data: Partial<EventRow> }).data;
    const row = store.events.find((e) => e.id === id);
    if (!row) throw new Error("event not found");
    Object.assign(row, data);
    return row as never;
  });
  vi.mocked(db.calendarEvent.upsert).mockImplementation(async (args) => {
    const keyed = args as {
      where: {
        calendarId_providerEventId: {
          calendarId: string;
          providerEventId: string;
        };
      };
      create: Partial<EventRow>;
      update: Partial<EventRow>;
    };
    const { calendarId, providerEventId } =
      keyed.where.calendarId_providerEventId;
    const found = store.events.find(
      (e) => e.calendarId === calendarId && e.providerEventId === providerEventId,
    );
    if (found) {
      Object.assign(found, keyed.update);
      return found as never;
    }
    const row = eventRow({
      ...keyed.create,
      id: keyed.create.id ?? `evt-${++store.seq}`,
    } as EventRow);
    store.events.push(row);
    return row as never;
  });
  vi.mocked(db.calendarEvent.delete).mockImplementation(async (args) => {
    const id = (args as { where: { id: string } }).where.id;
    const idx = store.events.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error("event not found");
    const [row] = store.events.splice(idx, 1);
    store.instances = store.instances.filter((i) => i.eventId !== id);
    store.events = store.events.filter((e) => e.masterEventId !== id);
    return row as never;
  });
  vi.mocked(db.calendarEvent.deleteMany).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    const before = store.events.length;
    const removed = store.events.filter((e) =>
      whereMatch(e as unknown as Record<string, unknown>, where),
    );
    const removedIds = new Set(removed.map((e) => e.id));
    store.events = store.events.filter((e) => !removedIds.has(e.id));
    store.instances = store.instances.filter((i) => !removedIds.has(i.eventId));
    return { count: before - store.events.length } as never;
  });

  vi.mocked(db.calendarEventInstance.findMany).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    return store.instances.filter((i) =>
      whereMatch(i as unknown as Record<string, unknown>, where),
    ) as never;
  });
  vi.mocked(db.calendarEventInstance.deleteMany).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    const before = store.instances.length;
    store.instances = store.instances.filter(
      (i) => !whereMatch(i as unknown as Record<string, unknown>, where),
    );
    return { count: before - store.instances.length } as never;
  });
  vi.mocked(db.calendarEventInstance.createMany).mockImplementation(async (args) => {
    const data = (args as { data: InstanceRow[] }).data;
    store.instances.push(...data);
    return { count: data.length } as never;
  });

  vi.mocked(db.calendarTombstone.createMany).mockImplementation(async (args) => {
    const data = (args as { data: TombstoneRow[] }).data;
    for (const row of data) {
      const exists = store.tombstones.some(
        (t) => t.eventId === row.eventId && t.userId === row.userId,
      );
      if (!exists) store.tombstones.push(row);
    }
    return { count: data.length } as never;
  });
  vi.mocked(db.calendarTombstone.deleteMany).mockImplementation(async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where;
    const before = store.tombstones.length;
    store.tombstones = store.tombstones.filter(
      (t) => !whereMatch(t as unknown as Record<string, unknown>, where),
    );
    return { count: before - store.tombstones.length } as never;
  });
}

describe("calendar write-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.calendars = [];
    store.events = [];
    store.instances = [];
    store.tombstones = [];
    store.seq = 0;
    wireStore();
  });

  it("creates an event, stores provider id/etag, and rebuilds instances", async () => {
    store.calendars.push(calendar());
    adapter.createEvent.mockResolvedValue(remote());

    const { createEventForUser } = await import("@/lib/calendar/write");
    const result = await createEventForUser("u1", "cal-1", input());

    expect(result).toEqual({ id: expect.any(String) });
    expect(adapter.createEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      expect.objectContaining({ title: "Lunch" }),
    );
    const saved = store.events.find((e) => e.id === result.id);
    expect(saved).toMatchObject({
      providerEventId: "g-created",
      etag: "etag-new",
      title: "Lunch",
      userId: "u1",
      calendarId: "cal-1",
    });
    expect(store.instances.some((i) => i.eventId === result.id)).toBe(true);
  });

  it("passes icalUid and attendees through createEvent", async () => {
    store.calendars.push(calendar());
    adapter.createEvent.mockResolvedValue(
      remote({ icalUid: "invite-uid", attendeesJson: [{ email: "me@x.y" }] }),
    );

    const { createEventForUser } = await import("@/lib/calendar/write");
    await createEventForUser("u1", "cal-1", {
      ...input(),
      icalUid: "invite-uid",
      organizer: { email: "ada@x.y", name: "Ada" },
      attendees: [{ email: "me@x.y", self: true, status: "needsAction" }],
    });

    expect(adapter.createEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      expect.objectContaining({
        icalUid: "invite-uid",
        attendees: [{ email: "me@x.y", self: true, status: "needsAction" }],
        organizer: { email: "ada@x.y", name: "Ada" },
      }),
    );
  });

  it("refuses writes to a read-only calendar with status 403", async () => {
    store.calendars.push(calendar({ isReadOnly: true }));

    const { createEventForUser } = await import("@/lib/calendar/write");
    await expect(createEventForUser("u1", "cal-1", input())).rejects.toMatchObject(
      { status: 403 },
    );
    expect(adapter.createEvent).not.toHaveBeenCalled();
    expect(store.events).toHaveLength(0);
  });

  it("throws CalendarConflictError with Google toast text on 412", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ title: "Standup" }));
    adapter.getEvent.mockResolvedValue(
      remote({
        providerEventId: "g-1",
        title: "From Google",
        etag: "etag-provider",
      }),
    );
    adapter.updateEvent.mockImplementation(async () => {
      expect(store.events[0]?.title).toBe("Moved");
      throw new CalendarConflictError("Google");
    });

    const { updateEventForUser, CalendarConflictError: WriteConflict } =
      await import("@/lib/calendar/write");
    expect(WriteConflict).toBe(CalendarConflictError);

    const err = updateEventForUser("u1", "evt-1", input({ title: "Moved" }), "all");
    await expect(err).rejects.toBeInstanceOf(CalendarConflictError);
    await expect(err).rejects.toThrow("This event changed on Google.");
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(adapter.getEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      "g-1",
    );
    expect(store.events[0]?.title).toBe("From Google");
    expect(store.events[0]?.etag).toBe("etag-provider");
  });

  it("rolls the replica back to the snapshot when the adapter throws", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ title: "Standup" }));
    adapter.updateEvent.mockImplementation(async () => {
      expect(store.events[0]?.title).toBe("Moved");
      throw new Error("provider down");
    });

    const { updateEventForUser } = await import("@/lib/calendar/write");
    await expect(
      updateEventForUser("u1", "evt-1", input({ title: "Moved" }), "all"),
    ).rejects.toThrow("provider down");

    expect(store.events[0]?.title).toBe("Standup");
    expect(store.events[0]?.etag).toBe("etag-old");
  });

  it("delete this on a series writes an exception, not a master delete", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ rrule: "FREQ=DAILY" }));
    adapter.deleteEvent.mockResolvedValue(undefined);

    const { deleteEventForUser } = await import("@/lib/calendar/write");
    await deleteEventForUser("u1", "evt-1", "this");

    expect(adapter.deleteEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      expect.objectContaining({
        providerEventId: "g-1",
        etag: "etag-old",
      }),
      "this",
    );
    expect(store.events.some((e) => e.id === "evt-1")).toBe(true);
    expect(store.tombstones).toHaveLength(0);
    const master = store.events.find((e) => e.id === "evt-1");
    expect(master?.exdate).toBeTruthy();
  });

  it("delete all removes the master and writes a tombstone", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ rrule: "FREQ=DAILY" }));
    adapter.deleteEvent.mockResolvedValue(undefined);

    const { deleteEventForUser } = await import("@/lib/calendar/write");
    await deleteEventForUser("u1", "evt-1", "all");

    expect(adapter.deleteEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      expect.objectContaining({
        providerEventId: "g-1",
        etag: "etag-old",
      }),
      "all",
    );
    expect(store.events.some((e) => e.id === "evt-1")).toBe(false);
    expect(store.tombstones).toEqual([
      expect.objectContaining({
        eventId: "evt-1",
        providerEventId: "g-1",
        userId: "u1",
      }),
    ]);
  });

  it("moves on the adapter for a same-account calendar change and drops source instances", async () => {
    const acc = account();
    store.calendars.push(calendar({ account: acc }));
    store.calendars.push(
      calendar({
        id: "cal-2",
        providerCalendarId: "work",
        name: "Work",
        accountId: acc.id,
        account: acc,
      }),
    );
    store.events.push(eventRow());
    store.instances.push({
      startAt: new Date("2026-08-20T10:00:00.000Z"),
      endAt: new Date("2026-08-20T11:00:00.000Z"),
      isAllDay: false,
      isCancelled: false,
      isException: false,
      eventId: "evt-1",
      calendarId: "cal-1",
      userId: "u1",
    });
    adapter.moveEvent.mockResolvedValue(
      remote({ providerEventId: "g-1", title: "Standup", etag: "etag-moved" }),
    );

    const { updateEventForUser } = await import("@/lib/calendar/write");
    await updateEventForUser(
      "u1",
      "evt-1",
      {
        title: "Standup",
        description: null,
        location: null,
        startAt: new Date("2026-08-20T10:00:00.000Z"),
        endAt: new Date("2026-08-20T11:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: null,
        calendarId: "cal-2",
      },
      "all",
    );

    expect(adapter.moveEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      { providerCalendarId: "work" },
      expect.objectContaining({ providerEventId: "g-1", etag: "etag-old" }),
    );
    expect(adapter.updateEvent).not.toHaveBeenCalled();
    expect(adapter.createEvent).not.toHaveBeenCalled();
    expect(adapter.deleteEvent).not.toHaveBeenCalled();
    expect(store.events[0]?.calendarId).toBe("cal-2");
    expect(store.instances.filter((i) => i.eventId === "evt-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "evt-1", calendarId: "cal-2" }),
      ]),
    );
    expect(
      store.instances.some((i) => i.eventId === "evt-1" && i.calendarId === "cal-1"),
    ).toBe(false);
  });

  it("patches EventInput on the destination after a same-account move", async () => {
    const acc = account();
    store.calendars.push(calendar({ account: acc }));
    store.calendars.push(
      calendar({
        id: "cal-2",
        providerCalendarId: "work",
        name: "Work",
        accountId: acc.id,
        account: acc,
      }),
    );
    store.events.push(eventRow({ title: "Standup" }));
    adapter.moveEvent.mockResolvedValue(
      remote({ providerEventId: "g-1", title: "Standup", etag: "etag-moved" }),
    );
    adapter.updateEvent.mockResolvedValue(
      remote({ providerEventId: "g-1", title: "Lunch", etag: "etag-patched" }),
    );

    const { updateEventForUser } = await import("@/lib/calendar/write");
    await updateEventForUser(
      "u1",
      "evt-1",
      { ...input({ title: "Lunch" }), calendarId: "cal-2" },
      "all",
    );

    expect(adapter.moveEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      { providerCalendarId: "work" },
      expect.objectContaining({ providerEventId: "g-1", etag: "etag-old" }),
    );
    expect(adapter.updateEvent).toHaveBeenCalledWith(
      { providerCalendarId: "work" },
      expect.objectContaining({
        providerEventId: "g-1",
        etag: "etag-moved",
      }),
      expect.objectContaining({ title: "Lunch" }),
      "all",
    );
    expect(adapter.moveEvent.mock.invocationCallOrder[0]!).toBeLessThan(
      adapter.updateEvent.mock.invocationCallOrder[0]!,
    );
    expect(store.events[0]?.calendarId).toBe("cal-2");
    expect(store.events[0]?.title).toBe("Lunch");
    expect(store.events[0]?.etag).toBe("etag-patched");
  });

  it("throws 400 on a cross-account calendar move", async () => {
    store.calendars.push(calendar());
    store.calendars.push(
      calendar({
        id: "cal-2",
        providerCalendarId: "other",
        accountId: "acc-2",
        account: account({ id: "acc-2" }),
      }),
    );
    store.events.push(eventRow());

    const { updateEventForUser } = await import("@/lib/calendar/write");
    await expect(
      updateEventForUser(
        "u1",
        "evt-1",
        { ...input(), calendarId: "cal-2" },
        "all",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(adapter.moveEvent).not.toHaveBeenCalled();
    expect(adapter.updateEvent).not.toHaveBeenCalled();
    expect(store.events[0]?.calendarId).toBe("cal-1");
  });

  it("does not stamp startAt as recurrenceId for a non-series this edit", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ rrule: null, recurrenceId: null }));
    adapter.updateEvent.mockResolvedValue(remote({ providerEventId: "g-1" }));

    const { updateEventForUser } = await import("@/lib/calendar/write");
    await updateEventForUser("u1", "evt-1", input(), "this");

    expect(adapter.updateEvent).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      expect.objectContaining({
        providerEventId: "g-1",
        recurrenceId: null,
      }),
      expect.objectContaining({ title: "Lunch" }),
      "this",
    );
  });

  it("restores exception rows when delete all rolls back", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ rrule: "FREQ=DAILY" }));
    store.events.push(
      eventRow({
        id: "evt-ex",
        providerEventId: "g-1-ex",
        masterEventId: "evt-1",
        recurrenceId: new Date("2026-08-21T10:00:00.000Z"),
        title: "Exception",
      }),
    );
    adapter.deleteEvent.mockRejectedValue(new Error("provider down"));

    const { deleteEventForUser } = await import("@/lib/calendar/write");
    await expect(deleteEventForUser("u1", "evt-1", "all")).rejects.toThrow(
      "provider down",
    );

    expect(store.events.map((e) => e.id).sort()).toEqual(["evt-1", "evt-ex"]);
    expect(store.events.find((e) => e.id === "evt-ex")?.title).toBe("Exception");
  });

  it("restores master instances when delete this on an exception rolls back", async () => {
    store.calendars.push(calendar());
    store.events.push(eventRow({ rrule: "FREQ=DAILY" }));
    store.events.push(
      eventRow({
        id: "evt-ex",
        providerEventId: "g-1-ex",
        masterEventId: "evt-1",
        recurrenceId: new Date("2026-08-21T10:00:00.000Z"),
        title: "Exception",
      }),
    );
    store.instances.push({
      startAt: new Date("2026-08-20T10:00:00.000Z"),
      endAt: new Date("2026-08-20T11:00:00.000Z"),
      isAllDay: false,
      isCancelled: false,
      isException: false,
      eventId: "evt-1",
      calendarId: "cal-1",
      userId: "u1",
    });
    adapter.deleteEvent.mockRejectedValue(new Error("provider down"));

    const { deleteEventForUser } = await import("@/lib/calendar/write");
    await expect(deleteEventForUser("u1", "evt-ex", "this")).rejects.toThrow(
      "provider down",
    );

    expect(store.events.find((e) => e.id === "evt-ex")?.status).toBe(
      "confirmed",
    );
    const masterInstance = store.instances.find(
      (i) =>
        i.eventId === "evt-1" &&
        i.startAt.getTime() === new Date("2026-08-20T10:00:00.000Z").getTime(),
    );
    expect(masterInstance).toMatchObject({
      isCancelled: false,
      isException: false,
    });
  });
});
