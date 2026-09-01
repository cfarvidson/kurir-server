import { describe, it, expect } from "vitest";
import {
  formatBusyHours,
  formatRank,
  formatRepliesIn,
  formatResponseTime,
  histogramFractions,
} from "@/lib/mail/person-format";

describe("formatResponseTime", () => {
  it("rounds to a coarse unit", () => {
    expect(formatResponseTime(null)).toBeNull();
    expect(formatResponseTime(20)).toBe("<1m");
    expect(formatResponseTime(45 * 60)).toBe("45m");
    expect(formatResponseTime(3 * 3600)).toBe("3h");
    expect(formatResponseTime(4.5 * 3600)).toBe("4.5h");
    expect(formatResponseTime(13 * 3600)).toBe("13h");
    expect(formatResponseTime(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(formatResponseTime(3 * 86400)).toBe("3d");
    expect(formatResponseTime(15 * 86400)).toBe("2w");
  });
});

describe("formatRank", () => {
  it("reads as a position among the people you mail most", () => {
    expect(formatRank(3, 41)).toEqual({
      badge: "#3",
      tail: "of the 41 people you mail most",
    });
    expect(formatRank(null, 41)).toBeNull();
    expect(formatRank(1, 0)).toBeNull();
  });
});

describe("histogramFractions", () => {
  it("scales to the busiest hour and handles an empty histogram", () => {
    expect(histogramFractions([0, 2, 4])).toEqual([0, 0.5, 1]);
    expect(histogramFractions([0, 0])).toEqual([0, 0]);
  });
});

describe("formatBusyHours", () => {
  it("names the shortest peak range", () => {
    const hours = Array(24).fill(0);
    hours[9] = 4;
    hours[10] = 8;
    hours[11] = 4;
    expect(formatBusyHours(hours)).toBe("Usually writes 09-12");
  });

  it("uses the hour slot for a single peak hour", () => {
    const hours = Array(24).fill(0);
    hours[9] = 5;
    hours[15] = 1;
    expect(formatBusyHours(hours)).toBe("Usually writes 09-10");
  });

  it("wraps midnight", () => {
    const hours = Array(24).fill(0);
    hours[23] = 6;
    hours[0] = 6;
    hours[1] = 3;
    hours[12] = 1;
    expect(formatBusyHours(hours)).toBe("Usually writes 23-02");
  });

  it("is null when empty, a single mail, or flat", () => {
    expect(formatBusyHours(Array(24).fill(0))).toBeNull();
    const one = Array(24).fill(0);
    one[9] = 1;
    expect(formatBusyHours(one)).toBeNull();
    const flat = Array(24).fill(0);
    flat[9] = 2;
    flat[15] = 2;
    expect(formatBusyHours(flat)).toBeNull();
  });
});

describe("formatRepliesIn", () => {
  it("leads with Replies in", () => {
    expect(formatRepliesIn(4 * 3600)).toBe("Replies in 4h");
    expect(formatRepliesIn(45 * 60)).toBe("Replies in 45m");
    expect(formatRepliesIn(null)).toBeNull();
  });
});
