import { describe, it, expect } from "vitest";
import { compareVersions } from "@/lib/updates/compare-versions";

describe("compareVersions", () => {
  it("orders YYYY.MM.N left to right", () => {
    expect(compareVersions("2026.08.20", "2026.08.21")).toBe(-1);
    expect(compareVersions("2026.08.21", "2026.08.20")).toBe(1);
    expect(compareVersions("2026.08.20", "2026.08.20")).toBe(0);
    expect(compareVersions("2026.08.21", "2026.09.1")).toBe(-1);
  });

  it("treats a new-scheme release as newer than a same-month date tag", () => {
    expect(compareVersions("2026.08.19.3", "2026.08.20")).toBe(-1);
    expect(compareVersions("2026.08.20", "2026.08.19.3")).toBe(1);
  });

  it("would treat N=1 as older than a leftover day-based third component", () => {
    expect(compareVersions("2026.08.1", "2026.08.19.3")).toBe(-1);
  });

  it("treats a missing extra component as 0", () => {
    expect(compareVersions("2026.08.19", "2026.08.19.2")).toBe(-1);
  });
});
