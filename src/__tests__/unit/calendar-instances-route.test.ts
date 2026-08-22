import { describe, it, expect } from "vitest";
import { parseInstancesRange } from "@/lib/calendar/instances-route";

describe("parseInstancesRange", () => {
  it("parses a valid range", () => {
    const parsed = parseInstancesRange("2026-08-18", "2026-08-25");
    expect(parsed).toEqual({
      start: { year: 2026, month: 8, day: 18 },
      endExclusive: { year: 2026, month: 8, day: 25 },
    });
  });

  it("rejects missing or malformed params", () => {
    expect(parseInstancesRange(null, "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-18", null)).toBeNull();
    expect(parseInstancesRange("18-08-2026", "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-18", "not-a-date")).toBeNull();
  });

  it("rejects end <= start", () => {
    expect(parseInstancesRange("2026-08-25", "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-25", "2026-08-18")).toBeNull();
  });

  it("clamps spans longer than 31 days", () => {
    const parsed = parseInstancesRange("2026-08-01", "2026-12-01");
    expect(parsed?.endExclusive).toEqual({ year: 2026, month: 9, day: 1 });
  });
});
