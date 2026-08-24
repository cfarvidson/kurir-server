import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdmin, findUnique, startUpdate, pkg } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  startUpdate: vi.fn(),
  pkg: { version: "2026.30" },
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    systemSettings: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

vi.mock("@/lib/updates/update-executor", () => ({
  startUpdate: (...args: unknown[]) => startUpdate(...args),
}));

vi.mock("@/../package.json", () => ({ default: pkg }));

describe("POST /api/admin/updates/apply", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({});
    findUnique.mockReset();
    startUpdate
      .mockReset()
      .mockResolvedValue({ started: true, logId: "log-1" });
    pkg.version = "2026.30";
  });

  it("reinstalls the stable image when running ahead of the top-level pointer", async () => {
    findUnique.mockResolvedValue({
      updateAvailable: false,
      latestVersion: "2026.29",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.29",
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();

    expect(res.status).toBe(202);
    expect(startUpdate).toHaveBeenCalledWith("2026.29", "manual");
  });

  it("does not start an install on an ordinary up-to-date stable instance", async () => {
    pkg.version = "2026.29";
    findUnique.mockResolvedValue({
      updateAvailable: false,
      latestVersion: "2026.29",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.29",
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("No update available");
    expect(startUpdate).not.toHaveBeenCalled();
  });
});
