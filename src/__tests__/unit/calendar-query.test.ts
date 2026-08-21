import { describe, it, expect, vi, beforeEach } from "vitest";

type CalendarMeta = {
  id: string;
  name: string;
  color: string | null;
  isVisible: boolean;
};

type EventRow = {
  id: string;
  userId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  transparency: string;
  status: string;
  location: string | null;
  description: string | null;
  masterEventId: string | null;
  recurrenceId: Date | null;
  calendarId: string;
  calendar: CalendarMeta;
  exceptions: EventRow[];
};

type InstanceRow = {
  eventId: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  userId: string;
  calendarId: string;
  event: { title: string };
  calendar: CalendarMeta;
};

const store: { instances: InstanceRow[]; events: EventRow[] } = {
  instances: [],
  events: [],
};

function matchInstance(
  row: InstanceRow,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  if (where.userId != null && row.userId !== where.userId) return false;
  if (where.isCancelled === false && row.isCancelled) return false;
  const startAt = where.startAt as { lt?: Date } | undefined;
  if (startAt?.lt && !(row.startAt < startAt.lt)) return false;
  const endAt = where.endAt as { gt?: Date } | undefined;
  if (endAt?.gt && !(row.endAt > endAt.gt)) return false;
  const calendar = where.calendar as { isVisible?: boolean } | undefined;
  if (calendar?.isVisible === true && !row.calendar.isVisible) return false;
  return true;
}

function matchEvent(
  row: EventRow,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  const { OR, ...rest } = where as {
    OR?: Array<Record<string, unknown>>;
    userId?: string;
    masterEventId?: string | null;
    recurrenceId?: Date | null;
    calendar?: { isVisible?: boolean };
    rrule?: { not?: null };
    startAt?: { lt?: Date };
  };
  if (rest.userId != null && row.userId !== rest.userId) return false;
  if (rest.masterEventId === null && row.masterEventId != null) return false;
  if (rest.recurrenceId === null && row.recurrenceId != null) return false;
  if (rest.calendar?.isVisible === true && !row.calendar.isVisible) return false;
  if (rest.rrule && "not" in rest.rrule && rest.rrule.not === null) {
    if (row.rrule == null) return false;
  }
  if (rest.startAt?.lt && !(row.startAt < rest.startAt.lt)) return false;
  if (OR && !OR.some((clause) => matchEvent(row, clause))) return false;
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    calendarEventInstance: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        store.instances.filter((row) => matchInstance(row, where)),
      ),
    },
    calendarEvent: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        store.events.filter((row) => matchEvent(row, where)),
      ),
    },
  },
}));

import { db } from "@/lib/db";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const WEEK_FROM = new Date("2026-08-17T00:00:00.000Z");
const WEEK_TO = new Date("2026-08-24T00:00:00.000Z");

const visibleCal: CalendarMeta = {
  id: "cal-visible",
  name: "Personal",
  color: "#c45c26",
  isVisible: true,
};

const hiddenCal: CalendarMeta = {
  id: "cal-hidden",
  name: "Hidden",
  color: "#2563eb",
  isVisible: false,
};

function instance(partial: Partial<InstanceRow> & Pick<InstanceRow, "eventId">): InstanceRow {
  return {
    startAt: new Date("2026-08-20T10:00:00.000Z"),
    endAt: new Date("2026-08-20T11:00:00.000Z"),
    isAllDay: false,
    isCancelled: false,
    isException: false,
    userId: "u1",
    calendarId: visibleCal.id,
    event: { title: "Standup" },
    calendar: visibleCal,
    ...partial,
  };
}

describe("listVisibleInstancesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.instances = [];
    store.events = [];
  });

  it("excludes isVisible:false calendars and cancelled instances", async () => {
    store.instances = [
      instance({
        eventId: "evt-visible",
        event: { title: "Standup" },
        calendar: visibleCal,
        calendarId: visibleCal.id,
      }),
      instance({
        eventId: "evt-cancelled",
        isCancelled: true,
        event: { title: "Cancelled" },
        calendar: visibleCal,
        calendarId: visibleCal.id,
        startAt: new Date("2026-08-20T12:00:00.000Z"),
        endAt: new Date("2026-08-20T13:00:00.000Z"),
      }),
      instance({
        eventId: "evt-hidden",
        event: { title: "Secret" },
        calendar: hiddenCal,
        calendarId: hiddenCal.id,
        startAt: new Date("2026-08-20T14:00:00.000Z"),
        endAt: new Date("2026-08-20T15:00:00.000Z"),
      }),
    ];

    const rows = await listVisibleInstancesForUser("u1", WEEK_FROM, WEEK_TO, NOW);

    expect(db.calendarEventInstance.findMany).toHaveBeenCalled();
    expect(rows.map((row) => row.eventId)).toEqual(["evt-visible"]);
    expect(rows[0]).toMatchObject({
      title: "Standup",
      calendarId: "cal-visible",
      color: "#c45c26",
      calendarName: "Personal",
      isCancelled: false,
    });
  });

  it("expands masters outside the instance window instead of the instance table", async () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const to = new Date("2025-01-04T00:00:00.000Z");
    store.instances = [
      instance({ eventId: "should-not-read" }),
    ];
    store.events = [
      {
        id: "master-visible",
        userId: "u1",
        title: "Daily",
        startAt: new Date("2025-01-01T08:00:00.000Z"),
        endAt: new Date("2025-01-01T09:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: "FREQ=DAILY;COUNT=5",
        rdate: null,
        exdate: null,
        transparency: "busy",
        status: "confirmed",
        location: "HQ",
        description: "Standup notes",
        masterEventId: null,
        recurrenceId: null,
        calendarId: visibleCal.id,
        calendar: visibleCal,
        exceptions: [
          {
            id: "ex-1",
            userId: "u1",
            title: "Daily",
            startAt: new Date("2025-01-02T08:00:00.000Z"),
            endAt: new Date("2025-01-02T09:00:00.000Z"),
            isAllDay: false,
            timezone: "UTC",
            rrule: null,
            rdate: null,
            exdate: null,
            transparency: "busy",
            status: "cancelled",
            location: "HQ",
            description: "Standup notes",
            masterEventId: "master-visible",
            recurrenceId: new Date("2025-01-02T08:00:00.000Z"),
            calendarId: visibleCal.id,
            calendar: visibleCal,
            exceptions: [],
          },
        ],
      },
      {
        id: "master-hidden",
        userId: "u1",
        title: "Hidden daily",
        startAt: new Date("2025-01-01T10:00:00.000Z"),
        endAt: new Date("2025-01-01T11:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: "FREQ=DAILY;COUNT=5",
        rdate: null,
        exdate: null,
        transparency: "busy",
        status: "confirmed",
        location: null,
        description: null,
        masterEventId: null,
        recurrenceId: null,
        calendarId: hiddenCal.id,
        calendar: hiddenCal,
        exceptions: [],
      },
    ];

    const rows = await listVisibleInstancesForUser("u1", from, to, NOW);

    expect(db.calendarEventInstance.findMany).not.toHaveBeenCalled();
    expect(rows.map((row) => row.startAt.toISOString()).sort()).toEqual([
      "2025-01-01T08:00:00.000Z",
      "2025-01-03T08:00:00.000Z",
    ]);
    expect(rows.every((row) => row.calendarId === "cal-visible")).toBe(true);
    expect(rows.every((row) => !row.isCancelled)).toBe(true);
  });

  it("joins exception location and description on on-the-fly expand", async () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const to = new Date("2025-01-04T00:00:00.000Z");
    store.events = [
      {
        id: "master-notes",
        userId: "u1",
        title: "Daily",
        startAt: new Date("2025-01-01T08:00:00.000Z"),
        endAt: new Date("2025-01-01T09:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: "FREQ=DAILY;COUNT=5",
        rdate: null,
        exdate: null,
        transparency: "busy",
        status: "confirmed",
        location: "HQ",
        description: "Standup notes",
        masterEventId: null,
        recurrenceId: null,
        calendarId: visibleCal.id,
        calendar: visibleCal,
        exceptions: [
          {
            id: "ex-room",
            userId: "u1",
            title: "Daily (room change)",
            startAt: new Date("2025-01-02T09:00:00.000Z"),
            endAt: new Date("2025-01-02T10:00:00.000Z"),
            isAllDay: false,
            timezone: "UTC",
            rrule: null,
            rdate: null,
            exdate: null,
            transparency: "busy",
            status: "confirmed",
            location: "Room B",
            description: "Moved",
            masterEventId: "master-notes",
            recurrenceId: new Date("2025-01-02T08:00:00.000Z"),
            calendarId: visibleCal.id,
            calendar: visibleCal,
            exceptions: [],
          },
        ],
      },
    ];

    const rows = await listVisibleInstancesForUser("u1", from, to, NOW);
    const regular = rows.find(
      (row) => row.startAt.toISOString() === "2025-01-01T08:00:00.000Z",
    );
    const patched = rows.find((row) => row.isException);

    expect(regular).toMatchObject({
      location: "HQ",
      description: "Standup notes",
      rrule: "FREQ=DAILY;COUNT=5",
      isException: false,
    });
    expect(patched).toMatchObject({
      title: "Daily (room change)",
      location: "Room B",
      description: "Moved",
      isException: true,
      rrule: "FREQ=DAILY;COUNT=5",
      startAt: new Date("2025-01-02T09:00:00.000Z"),
    });
  });
});
