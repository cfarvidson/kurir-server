import { describe, it, expect } from "vitest";
import { safeInternalPath } from "@/lib/mail/compose-origin";

describe("safeInternalPath", () => {
  it("accepts a normal internal path", () => {
    expect(safeInternalPath("/feed")).toBe("/feed");
    expect(safeInternalPath("/paper-trail")).toBe("/paper-trail");
    expect(safeInternalPath("/scheduled")).toBe("/scheduled");
  });

  it("accepts internal paths with query strings", () => {
    expect(safeInternalPath("/imbox/abc123")).toBe("/imbox/abc123");
    expect(safeInternalPath("/search?q=hi")).toBe("/search?q=hi");
  });

  it("rejects protocol-relative URLs (open-redirect guard)", () => {
    expect(safeInternalPath("//evil.com")).toBeNull();
    expect(safeInternalPath("//evil.com/path")).toBeNull();
  });

  it("rejects absolute URLs", () => {
    expect(safeInternalPath("https://evil.com")).toBeNull();
    expect(safeInternalPath("http://evil.com")).toBeNull();
  });

  it("rejects non-rooted / relative values", () => {
    expect(safeInternalPath("feed")).toBeNull();
    expect(safeInternalPath("javascript:alert(1)")).toBeNull();
  });

  it("returns null for missing values", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
  });
});
