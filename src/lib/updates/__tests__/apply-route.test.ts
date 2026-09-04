import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdmin, findUnique, update, startUpdate, checkImageExists, pkg } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    startUpdate: vi.fn(),
    checkImageExists: vi.fn(),
    pkg: { version: "2026.30" },
  }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    systemSettings: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

vi.mock("@/lib/updates/update-executor", () => ({
  startUpdate: (...args: unknown[]) => startUpdate(...args),
}));

vi.mock("@/lib/updates/image-availability", () => ({
  checkImageExists: (...args: unknown[]) => checkImageExists(...args),
}));

vi.mock("@/../package.json", () => ({ default: pkg }));

describe("POST /api/admin/updates/apply", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({});
    findUnique.mockReset();
    update.mockReset().mockResolvedValue({});
    startUpdate
      .mockReset()
      .mockResolvedValue({ started: true, logId: "log-1" });
    checkImageExists.mockReset().mockResolvedValue(true);
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

  it("re-verifies the image and records the verdict before starting", async () => {
    findUnique.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.31",
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();

    expect(res.status).toBe(202);
    expect(checkImageExists).toHaveBeenCalledWith(
      "ghcr.io/cfarvidson/kurir-server:v2026.31",
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageAvailable: true }),
      }),
    );
    expect(startUpdate).toHaveBeenCalledWith("2026.31", "manual");
  });

  it("refuses with 409 when the image is not published yet", async () => {
    checkImageExists.mockResolvedValue(false);
    findUnique.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.31",
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/v2026\.31 is not published yet/);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageAvailable: false }),
      }),
    );
    expect(startUpdate).not.toHaveBeenCalled();
  });

  it("refuses when no image reference has been recorded", async () => {
    findUnique.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      latestImageTag: null,
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/check for updates first/);
    expect(checkImageExists).not.toHaveBeenCalled();
    expect(startUpdate).not.toHaveBeenCalled();
  });

  it("refuses with 503 when the registry cannot be reached", async () => {
    checkImageExists.mockRejectedValue(new Error("ECONNRESET"));
    findUnique.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.31",
      updateChannel: "stable",
    });

    const { POST } = await import("@/app/api/admin/updates/apply/route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/Could not verify/);
    expect(update).not.toHaveBeenCalled();
    expect(startUpdate).not.toHaveBeenCalled();
  });
});
