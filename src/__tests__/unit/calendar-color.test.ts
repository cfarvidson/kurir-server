import { describe, it, expect } from "vitest";
import { eventBlockStyle, readableTextTone } from "@/lib/calendar/color";

describe("eventBlockStyle", () => {
  it("returns rail and fill CSS variables for a provider hex", () => {
    expect(eventBlockStyle("#c45c26")).toEqual({
      "--event-color": "#c45c26",
      "--event-fill":
        "color-mix(in srgb, var(--event-color) 24%, var(--background))",
    });
  });

  it("normalizes missing hash, uppercase, and blank values", () => {
    expect(eventBlockStyle("B45309")["--event-color"]).toBe("#b45309");
    expect(eventBlockStyle("  #abc  ")["--event-color"]).toBe("#aabbcc");
    expect(eventBlockStyle("")["--event-color"]).toBe("#737373");
    expect(eventBlockStyle("nope")["--event-color"]).toBe("#737373");
  });
});

describe("readableTextTone", () => {
  it("puts light text on dark fills", () => {
    expect(readableTextTone("#7c3aed")).toBe("light"); // violet
    expect(readableTextTone("#059669")).toBe("light"); // emerald
    expect(readableTextTone("#000000")).toBe("light");
  });

  it("puts dark text on light fills", () => {
    expect(readableTextTone("#fbbf24")).toBe("dark"); // amber
    expect(readableTextTone("#ffffff")).toBe("dark");
    expect(readableTextTone("#a3e635")).toBe("dark"); // lime
  });

  it("normalizes input like the fill does", () => {
    expect(readableTextTone("059669")).toBe("light");
    expect(readableTextTone("")).toBe(readableTextTone("#737373"));
  });
});
