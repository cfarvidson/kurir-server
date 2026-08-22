import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  DEMO_CALENDAR_TIMEZONE,
  demoCalendarSeed,
} from "@/lib/calendar/demo-seed";
import { freetimeSpans } from "@/lib/calendar/range";
import {
  civilFromZoned,
  zonedParts,
  zonedWallToUtc,
} from "@/lib/calendar/view-time";

describe("demoCalendarSeed", () => {
  const now = new Date("2026-08-20T12:00:00.000Z"); // Thursday afternoon Stockholm

  it("seeds one CALDAV account and two calendars", () => {
    const seed = demoCalendarSeed(now);
    expect(seed.account.provider).toBe("CALDAV");
    expect(seed.calendars).toHaveLength(2);

    const personal = seed.calendars.find((c) => c.name === "Personal");
    const holidays = seed.calendars.find((c) => c.name === "Holidays");
    expect(personal).toMatchObject({
      color: "#b45309",
      isReadOnly: false,
      isPrimary: true,
    });
    expect(holidays).toMatchObject({
      isReadOnly: true,
      isPrimary: false,
    });
  });

  it("includes one all-day and one ~09:00 timed event this week", () => {
    const seed = demoCalendarSeed(now);
    const events = seed.calendars.flatMap((c) => c.events);
    const allDay = events.filter((e) => e.isAllDay);
    const timed = events.filter((e) => !e.isAllDay);
    expect(allDay.length).toBeGreaterThanOrEqual(1);
    expect(timed.length).toBeGreaterThanOrEqual(1);

    const morning = timed.find((e) => {
      const wall = zonedParts(e.startAt, DEMO_CALENDAR_TIMEZONE);
      return wall.hour === 9 && wall.minute === 0;
    });
    expect(morning).toBeDefined();
  });

  it("leaves a 3-hour local gap between 10:00 and 13:00 for freetime", () => {
    const seed = demoCalendarSeed(now);
    const day = civilFromZoned(now, DEMO_CALENDAR_TIMEZONE);
    const dayStart = zonedWallToUtc(DEMO_CALENDAR_TIMEZONE, {
      ...day,
      hour: 7,
      minute: 0,
    });
    const dayEnd = zonedWallToUtc(DEMO_CALENDAR_TIMEZONE, {
      ...day,
      hour: 21,
      minute: 0,
    });
    const gapStart = zonedWallToUtc(DEMO_CALENDAR_TIMEZONE, {
      ...day,
      hour: 10,
      minute: 0,
    });
    const gapEnd = zonedWallToUtc(DEMO_CALENDAR_TIMEZONE, {
      ...day,
      hour: 13,
      minute: 0,
    });

    const instances = seed.calendars.flatMap((c) =>
      c.events.map((e) => ({
        startAt: e.startAt,
        endAt: e.endAt,
        isAllDay: e.isAllDay,
        isCancelled: false as const,
        transparency: "busy" as const,
      })),
    );
    const spans = freetimeSpans(instances, dayStart, dayEnd, 180);
    const hasGap = spans.some(
      (s) =>
        s.startAt.getTime() <= gapStart.getTime() &&
        s.endAt.getTime() >= gapEnd.getTime(),
    );
    expect(hasGap).toBe(true);
  });
});

describe("wipeMailData calendar privacy", () => {
  it("does not call calendarAccount.deleteMany", async () => {
    const calendarAccount = { deleteMany: vi.fn() };
    const emailConnection = {
      findMany: vi.fn().mockResolvedValue([{ id: "conn-1" }]),
    };
    const message = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const folder = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const sender = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const draft = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const scheduledMessage = {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const syncState = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };

    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
      canManageConnections: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("@/lib/db", () => ({
      db: {
        calendarAccount,
        emailConnection,
        message,
        folder,
        sender,
        draft,
        scheduledMessage,
        syncState,
        $transaction: vi.fn(async (ops: Promise<unknown>[]) =>
          Promise.all(ops),
        ),
      },
    }));
    vi.doMock("next/cache", () => ({
      revalidatePath: vi.fn(),
      updateTag: vi.fn(),
    }));
    vi.doMock("@/lib/mail/connection-manager", () => ({
      connectionManager: { stopAllForUser: vi.fn().mockResolvedValue(undefined) },
    }));

    const { wipeMailData } = await import("@/actions/wipe");
    await wipeMailData();

    expect(calendarAccount.deleteMany).not.toHaveBeenCalled();

    const wipeSrc = readFileSync(
      path.join(__dirname, "../../actions/wipe.ts"),
      "utf8",
    );
    expect(wipeSrc).toMatch(/CalendarAccount|calendar account/i);
    // Call site only - the doc comment may mention the forbidden API by name.
    expect(wipeSrc).not.toMatch(
      /\bdb\.calendarAccount\.deleteMany\s*\(/,
    );
  });
});
