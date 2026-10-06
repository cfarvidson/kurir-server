import { describe, it, expect, vi } from "vitest";

// `mobile.ts` pulls in `@/lib/mobile/auth` (next-auth) and `@/lib/calendar/write`
// (the Prisma client) just to build its route helpers - neither is exercised
// by these pure parser tests, and both fail to resolve outside a Next.js
// runtime, so stub them out before importing.
vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  parseOccurrence,
  serializeCalendarAccount,
  serializeRangeInstance,
  updateEventBodySchema,
} from "@/lib/calendar/mobile";
import type { VisibleInstance } from "@/lib/calendar/query";

describe("parseOccurrence", () => {
  it("parses a valid ISO string", () => {
    const result = parseOccurrence("2026-08-21T09:00:00.000Z");
    expect(result?.toISOString()).toBe("2026-08-21T09:00:00.000Z");
  });

  it("returns null for a malformed string", () => {
    expect(parseOccurrence("not-a-date")).toBeNull();
  });

  it("returns null for nil", () => {
    expect(parseOccurrence(null)).toBeNull();
  });
});

describe("serializeCalendarAccount", () => {
  const account = {
    id: "acc1",
    provider: "CALDAV" as const,
    displayName: "iCloud",
    principalEmail: "user@icloud.com",
    lastSyncedAt: new Date("2026-08-23T10:00:00.000Z"),
    lastError: null,
    oauthError: null,
    calendars: [
      {
        id: "cal1",
        name: "Personal",
        color: "#b45309",
        isVisible: true,
        isPrimary: true,
        isReadOnly: false,
        lastError: null,
      },
      {
        id: "cal2",
        name: "Family",
        color: null,
        isVisible: true,
        isPrimary: false,
        isReadOnly: false,
        lastError: "Collection query failed: 404 Not Found",
      },
    ],
  };

  /// A healthy account can still hold a calendar whose own pull died. Without
  /// this field the app renders that as a calendar with nothing in it.
  it("carries each calendar's own lastError", () => {
    const serialized = serializeCalendarAccount(account);

    expect(serialized.lastError).toBeNull();
    expect(serialized.calendars[0]?.lastError).toBeNull();
    expect(serialized.calendars[1]?.lastError).toBe(
      "Collection query failed: 404 Not Found",
    );
  });
});

describe("travel time over the mobile API", () => {
  const body = {
    title: "Dentist",
    startAt: "2026-10-09T08:00:00.000Z",
    endAt: "2026-10-09T09:00:00.000Z",
    isAllDay: false,
    range: "all",
  };

  it("accepts travelMinutes on an edit, and leaves it out when an older app does not send it", () => {
    expect(
      updateEventBodySchema.parse({ ...body, travelMinutes: 30 }).travelMinutes,
    ).toBe(30);
    expect(
      updateEventBodySchema.parse({ ...body, travelMinutes: null }).travelMinutes,
    ).toBeNull();
    expect(updateEventBodySchema.parse(body)).not.toHaveProperty("travelMinutes");
    expect(
      updateEventBodySchema.safeParse({ ...body, travelMinutes: -5 }).success,
    ).toBe(false);
    expect(
      updateEventBodySchema.parse({ ...body, travelAfterMinutes: 45 })
        .travelAfterMinutes,
    ).toBe(45);
    expect(updateEventBodySchema.parse(body)).not.toHaveProperty(
      "travelAfterMinutes",
    );
    for (const travelAfterMinutes of [-1, 1.5, 1441]) {
      expect(
        updateEventBodySchema.safeParse({ ...body, travelAfterMinutes }).success,
      ).toBe(false);
    }
  });

  it("returns travel time and where it starts on each instance", () => {
    const row = {
      eventId: "e1",
      title: "Dentist",
      startAt: new Date("2026-10-09T08:00:00.000Z"),
      endAt: new Date("2026-10-09T09:00:00.000Z"),
      isAllDay: false,
      isCancelled: false,
      isException: false,
      calendarId: "cal1",
      color: "#059669",
      calendarName: "Personal",
      transparency: "busy",
      location: null,
      description: null,
      rrule: null,
      isReadOnly: false,
      attendeesJson: null,
      travelMinutes: 25,
      travelStart: { title: "Home", address: null },
      travelAfterMinutes: 15,
    } as VisibleInstance;

    expect(serializeRangeInstance(row)).toMatchObject({
      travelMinutes: 25,
      travelStart: { title: "Home", address: null },
      travelAfterMinutes: 15,
    });
  });
});
