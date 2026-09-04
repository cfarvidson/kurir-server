import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { findUnique, checkForUpdates, startUpdate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  checkForUpdates: vi.fn(),
  startUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    systemSettings: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

vi.mock("@/lib/updates/version-checker", () => ({
  checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
}));

vi.mock("@/lib/updates/update-executor", () => ({
  startUpdate: (...args: unknown[]) => startUpdate(...args),
}));

async function runFirstTick() {
  const cron = await import("@/lib/updates/update-cron");
  cron.startUpdateChecker();
  await vi.advanceTimersByTimeAsync(30_000);
  cron.stopUpdateChecker();
}

describe("update-cron auto-apply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    findUnique.mockReset().mockResolvedValue({ updateMode: "auto" });
    startUpdate.mockReset().mockResolvedValue({ started: true });
    checkForUpdates.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies when the image is verified", async () => {
    checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      imageAvailable: true,
    });

    await runFirstTick();

    expect(startUpdate).toHaveBeenCalledWith("2026.31", "auto");
  });

  it("waits when the image is not published yet", async () => {
    checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      imageAvailable: false,
    });

    await runFirstTick();

    expect(startUpdate).not.toHaveBeenCalled();
  });

  it("waits when the image could not be verified", async () => {
    checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latestVersion: "2026.31",
      imageAvailable: null,
    });

    await runFirstTick();

    expect(startUpdate).not.toHaveBeenCalled();
  });
});
