import { describe, it, expect, vi } from "vitest";

const { pkg } = vi.hoisted(() => ({ pkg: { version: "2026.40" } }));

vi.mock("@/../package.json", () => ({ default: pkg }));

describe("GET /api/up", () => {
  it("exposes the running version for the updater's post-restart check", async () => {
    const { GET } = await import("@/app/api/up/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", version: "2026.40" });
  });
});
