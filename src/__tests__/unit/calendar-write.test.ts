import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarConflictError } from "@/lib/calendar/providers/types";
import type { EventInput, RemoteEvent } from "@/lib/calendar/providers/types";

const { adapter } = vi.hoisted(() => {
  const adapter = {
    listCalendars: vi.fn(),
    pull: vi.fn(),
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
    store.events.push(eventRow());
    adapter.updateEvent.mockRejectedValue(new CalendarConflictError("Google"));

    const { updateEventForUser, CalendarConflictError: WriteConflict } =
      await import("@/lib/calendar/write");
    expect(WriteConflict).toBe(CalendarConflictError);

    const err = updateEventForUser("u1", "evt-1", input({ title: "Moved" }), "all");
    await expect(err).rejects.toBeInstanceOf(CalendarConflictError);
    await expect(err).rejects.toThrow("This event changed on Google.");
    expect(adapter.pull).not.toHaveBeenCalled();
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
});
