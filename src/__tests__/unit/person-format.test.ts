import { describe, it, expect } from "vitest";
import {
  formatRank,
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
