/**
 * Integration tests for /api/mobile/meta — the app↔server version handshake.
 */
import { describe, it, expect } from "vitest";

describe("GET /api/mobile/meta", () => {
  it("returns the current contract versions without auth", async () => {
    const { GET } = await import("@/app/api/mobile/meta/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.apiVersion).toBe(1);
    expect(body.minSupportedAppApiVersion).toBe(1);
    expect(typeof body.serverVersion).toBe("string");
  });

  it("is cacheable (public, short max-age)", async () => {
    const { GET } = await import("@/app/api/mobile/meta/route");
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});
