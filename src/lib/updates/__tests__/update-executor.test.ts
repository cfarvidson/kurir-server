import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  logFindFirst,
  logCreate,
  logUpdate,
  settingsFindUnique,
  checkUpdaterHealth,
  pkg,
} = vi.hoisted(() => ({
  logFindFirst: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  settingsFindUnique: vi.fn(),
  checkUpdaterHealth: vi.fn(),
  pkg: { version: "2026.40" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    updateLog: {
      findFirst: (...args: unknown[]) => logFindFirst(...args),
      create: (...args: unknown[]) => logCreate(...args),
      update: (...args: unknown[]) => logUpdate(...args),
    },
    systemSettings: {
      findUnique: (...args: unknown[]) => settingsFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/updates/updater-health", () => ({
  checkUpdaterHealth: (...args: unknown[]) => checkUpdaterHealth(...args),
}));

vi.mock("@/../package.json", () => ({ default: pkg }));

const healthyUpdater = {
  configured: true,
  reachable: true,
  protocolVersion: 2,
  stale: false,
};

const staleUpdater = {
  configured: true,
  reachable: true,
  protocolVersion: null,
  stale: true,
};

function stubUpdaterAccepts() {
  const fetchMock = vi.fn(async () => ({
    status: 202,
    json: async () => ({ accepted: true }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function importExecutor() {
  vi.resetModules();
  return await import("../update-executor");
}

beforeEach(() => {
  vi.stubEnv("UPDATER_TOKEN", "secret");
  vi.stubEnv("UPDATER_URL", "http://updater:8080");
  logFindFirst.mockReset().mockResolvedValue(null);
  logCreate.mockReset().mockResolvedValue({ id: "log-1" });
  logUpdate.mockReset().mockResolvedValue({});
  settingsFindUnique.mockReset().mockResolvedValue({
    latestVersion: "2026.41",
    latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.41",
  });
  checkUpdaterHealth.mockReset().mockResolvedValue(healthyUpdater);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("startUpdate", () => {
  it("sends the pinned imageRef and target version to the updater", async () => {
    const fetchMock = stubUpdaterAccepts();
    const { startUpdate } = await importExecutor();

    const result = await startUpdate("2026.41", "manual");

    expect(result).toEqual({ started: true, logId: "log-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("http://updater:8080/apply");
    expect(JSON.parse(init.body)).toEqual({
      logId: "log-1",
      imageRef: "ghcr.io/cfarvidson/kurir-server:v2026.41",
      toVersion: "2026.41",
    });
  });

  it("refuses a stale sidecar and records the remediation command", async () => {
    const fetchMock = stubUpdaterAccepts();
    checkUpdaterHealth.mockResolvedValue(staleUpdater);
    const { startUpdate } = await importExecutor();

    const result = await startUpdate("2026.41", "auto");

    expect(result.started).toBe(false);
    expect(result.error).toContain(
      "docker compose pull updater && docker compose up -d updater",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    // The refusal is persisted as a failed UpdateLog entry so an unattended
    // auto-update surfaces in Admin -> Updates history.
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-1" },
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("docker compose pull updater"),
        }),
      }),
    );
  });
});

describe("startRollback", () => {
  it("passes the rollback target version so the sidecar can verify it", async () => {
    const fetchMock = stubUpdaterAccepts();
    logFindFirst
      .mockResolvedValueOnce(null) // no update in progress
      .mockResolvedValueOnce({ status: "success", fromVersion: "2026.39" });
    const { startRollback } = await importExecutor();

    const result = await startRollback();

    expect(result).toEqual({ started: true, logId: "log-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("http://updater:8080/rollback");
    expect(JSON.parse(init.body)).toEqual({
      logId: "log-1",
      toVersion: "2026.39",
    });
  });
});
