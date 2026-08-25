import { describe, it, expect, vi, afterEach } from "vitest";
import { checkUpdaterHealth } from "../updater-health";

function stubHealth(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("checkUpdaterHealth", () => {
  it("reports not configured (and skips the probe) without UPDATER_TOKEN", async () => {
    vi.stubEnv("UPDATER_TOKEN", "");
    const fetchMock = stubHealth({ ok: true });

    const health = await checkUpdaterHealth();

    expect(health).toEqual({
      configured: false,
      reachable: false,
      protocolVersion: null,
      stale: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a sidecar reporting the required protocol version", async () => {
    vi.stubEnv("UPDATER_TOKEN", "secret");
    stubHealth({ ok: true, protocolVersion: 2 });

    const health = await checkUpdaterHealth();

    expect(health).toEqual({
      configured: true,
      reachable: true,
      protocolVersion: 2,
      stale: false,
    });
  });

  it("flags a legacy sidecar without a protocolVersion as stale", async () => {
    vi.stubEnv("UPDATER_TOKEN", "secret");
    stubHealth({ ok: true });

    const health = await checkUpdaterHealth();

    expect(health).toEqual({
      configured: true,
      reachable: true,
      protocolVersion: null,
      stale: true,
    });
  });

  it("flags a sidecar below the required protocol version as stale", async () => {
    vi.stubEnv("UPDATER_TOKEN", "secret");
    stubHealth({ ok: true, protocolVersion: 1 });

    const health = await checkUpdaterHealth();

    expect(health.stale).toBe(true);
    expect(health.protocolVersion).toBe(1);
  });

  it("reports unreachable (not stale) when the probe fails", async () => {
    vi.stubEnv("UPDATER_TOKEN", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const health = await checkUpdaterHealth();

    expect(health).toEqual({
      configured: true,
      reachable: false,
      protocolVersion: null,
      stale: false,
    });
  });
});
