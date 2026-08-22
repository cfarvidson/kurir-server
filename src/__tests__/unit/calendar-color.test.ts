import { describe, it, expect } from "vitest";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";

describe("normalizeEventHex", () => {
  it("passes through a valid provider hex", () => {
    expect(normalizeEventHex("#c45c26")).toBe("#c45c26");
  });

  it("normalizes missing hash, short form, uppercase, and blank values", () => {
    expect(normalizeEventHex("B45309")).toBe("#b45309");
    expect(normalizeEventHex("  #abc  ")).toBe("#aabbcc");
    expect(normalizeEventHex("")).toBe("#737373");
    expect(normalizeEventHex("nope")).toBe("#737373");
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
