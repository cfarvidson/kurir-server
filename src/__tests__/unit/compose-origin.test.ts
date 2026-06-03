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

  it("rejects backslash variants the URL parser normalizes to '//'", () => {
    // The WHATWG URL parser treats "\" as "/", so these would resolve off-site.
    expect(safeInternalPath("/\\evil.com")).toBeNull();
    expect(safeInternalPath("/\\/evil.com")).toBeNull();
    expect(safeInternalPath("\\\\evil.com")).toBeNull();
  });

  it("rejects values containing control characters", () => {
    expect(safeInternalPath("/\tfoo")).toBeNull();
    expect(safeInternalPath("/\nfoo")).toBeNull();
    expect(safeInternalPath("/\r/evil.com")).toBeNull();
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
