import { describe, it, expect } from "vitest";
import { staggerRows } from "@/components/calendar/day-model";

describe("staggerRows", () => {
  // The dense day from the 2.0 review: 08:10, 09:00, 11:00, 11:30, 14:00,
  // 15:00, 18:00 and 18:30 on a narrow ribbon, labels 120 px wide. 11:30
  // and 18:30 fit in none of the three rows and used to be written over
  // the labels in the last row.
  it("hides a label no row has room for instead of writing it over another", () => {
    const labels = [31, 53, 106, 119, 185, 211, 291, 304].map((x) => ({
      x,
      width: 120,
    }));

    expect(staggerRows(labels)).toEqual([0, 1, 2, null, 0, 1, 2, null]);
  });
});
