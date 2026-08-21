import { describe, it, expect } from "vitest";
import { eventBlockStyle } from "@/lib/calendar/color";

describe("eventBlockStyle", () => {
  it("returns rail and fill CSS variables for a provider hex", () => {
    expect(eventBlockStyle("#c45c26")).toEqual({
      "--event-color": "#c45c26",
      "--event-fill":
        "color-mix(in srgb, var(--event-color) 18%, var(--background))",
    });
  });

  it("normalizes missing hash, uppercase, and blank values", () => {
    expect(eventBlockStyle("B45309")["--event-color"]).toBe("#b45309");
    expect(eventBlockStyle("  #abc  ")["--event-color"]).toBe("#aabbcc");
    expect(eventBlockStyle("")["--event-color"]).toBe("#737373");
    expect(eventBlockStyle("nope")["--event-color"]).toBe("#737373");
  });
});
