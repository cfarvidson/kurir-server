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
} from "@/lib/calendar/mobile";

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
