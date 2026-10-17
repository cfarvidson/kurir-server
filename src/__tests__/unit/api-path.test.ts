import { afterEach, describe, expect, it, vi } from "vitest";

describe("apiPath", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    vi.resetModules();
  });

  it("returns the path unchanged when no base path is set", async () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    const { apiPath, prefixAppUrls } = await import("@/lib/api-path");
    expect(apiPath("/api/up")).toBe("/api/up");
    expect(prefixAppUrls('<img src="/api/attachments/a">')).toBe(
      '<img src="/api/attachments/a">',
    );
  });

  it("prefixes root-relative app URLs and does not double-prefix", async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/kurir/";
    const { apiPath, prefixAppUrls } = await import("@/lib/api-path");
    expect(apiPath("/api/up")).toBe("/kurir/api/up");
    expect(apiPath("/kurir/api/up")).toBe("/kurir/api/up");
    expect(apiPath("https://example.com/api/up")).toBe(
      "https://example.com/api/up",
    );
    expect(prefixAppUrls('<a href="/api/attachments/a">')).toBe(
      '<a href="/kurir/api/attachments/a">',
    );
    expect(prefixAppUrls('<a href="https://example.com/x">')).toBe(
      '<a href="https://example.com/x">',
    );
  });
});
