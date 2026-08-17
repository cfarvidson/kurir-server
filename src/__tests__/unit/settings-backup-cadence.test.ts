import { describe, it, expect } from "vitest";
import {
  computeNextRunAt,
  advanceRunAt,
} from "@/lib/mail/settings-backup-cadence";

describe("computeNextRunAt", () => {
  it("returns null when cadence is off", () => {
    expect(
      computeNextRunAt({
        now: new Date("2026-08-17T10:00:00.000Z"),
        timezone: "UTC",
        cadence: "off",
      }),
    ).toBeNull();
  });

  it("picks today 03:00 local when that is still ahead", () => {
    // 01:00 UTC on 17 Aug = 03:00 has not happened yet in UTC
    const next = computeNextRunAt({
      now: new Date("2026-08-17T01:00:00.000Z"),
      timezone: "UTC",
      cadence: "daily",
    });
    expect(next?.toISOString()).toBe("2026-08-17T03:00:00.000Z");
  });

  it("picks tomorrow 03:00 local when today 03:00 has passed", () => {
    const next = computeNextRunAt({
      now: new Date("2026-08-17T10:00:00.000Z"),
      timezone: "UTC",
      cadence: "daily",
    });
    expect(next?.toISOString()).toBe("2026-08-18T03:00:00.000Z");
  });

  it("uses 03:00 in the user timezone", () => {
    // 2026-08-17 00:30 UTC = 02:30 in Stockholm (UTC+2) — 03:00 still ahead
    const next = computeNextRunAt({
      now: new Date("2026-08-17T00:30:00.000Z"),
      timezone: "Europe/Stockholm",
      cadence: "daily",
    });
    // 03:00 Stockholm = 01:00 UTC
    expect(next?.toISOString()).toBe("2026-08-17T01:00:00.000Z");
  });

  it("weekly keeps today's weekday when 03:00 is still ahead", () => {
    // Monday 2026-08-17 01:00 UTC
    const next = computeNextRunAt({
      now: new Date("2026-08-17T01:00:00.000Z"),
      timezone: "UTC",
      cadence: "weekly",
    });
    expect(next?.toISOString()).toBe("2026-08-17T03:00:00.000Z");
  });

  it("weekly jumps 7 days when today's 03:00 has passed", () => {
    const next = computeNextRunAt({
      now: new Date("2026-08-17T10:00:00.000Z"),
      timezone: "UTC",
      cadence: "weekly",
    });
    expect(next?.toISOString()).toBe("2026-08-24T03:00:00.000Z");
  });
});

describe("advanceRunAt", () => {
  it("adds one day for daily without drifting off 03:00", () => {
    const next = advanceRunAt({
      slot: new Date("2026-08-17T03:00:00.000Z"),
      timezone: "UTC",
      cadence: "daily",
    });
    expect(next.toISOString()).toBe("2026-08-18T03:00:00.000Z");
  });

  it("adds seven days for weekly", () => {
    const next = advanceRunAt({
      slot: new Date("2026-08-17T03:00:00.000Z"),
      timezone: "UTC",
      cadence: "weekly",
    });
    expect(next.toISOString()).toBe("2026-08-24T03:00:00.000Z");
  });
});
