import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  manifestSchema,
  compareVersions,
  checkForUpdates,
} from "../version-checker";

const upsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    systemSettings: {
      findFirst: vi.fn(async () => ({ updateManifestUrl: null })),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

// The instance in the acceptance criterion is running the last YYYY.MM.N release.
vi.mock("@/../package.json", () => ({ default: { version: "2026.08.27" } }));

const manifest = (overrides: Record<string, unknown> = {}) => ({
  version: "2026.28",
  image: "ghcr.io/cfarvidson/kurir-server:v2026.28",
  releaseUrl: "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.28",
  changelog: "Something changed",
  releasedAt: "2026-08-23T21:00:00Z",
  ...overrides,
});

describe("manifestSchema", () => {
  it("accepts a two-component YYYY.MICRO manifest", () => {
    const parsed = manifestSchema.parse(manifest());
    expect(parsed.version).toBe("2026.28");
    expect(parsed.image).toBe("ghcr.io/cfarvidson/kurir-server:v2026.28");
  });

  it("still accepts the three- and four-component versions already in the field", () => {
    expect(manifestSchema.parse(manifest({ version: "2026.08.27" })).version).toBe("2026.08.27");
    expect(manifestSchema.parse(manifest({ version: "2026.08.19.3" })).version).toBe("2026.08.19.3");
  });

  it("rejects versions that are not two to four numeric components", () => {
    expect(() => manifestSchema.parse(manifest({ version: "2026" }))).toThrow();
    expect(() => manifestSchema.parse(manifest({ version: "2026.1.2.3.4" }))).toThrow();
    expect(() => manifestSchema.parse(manifest({ version: "2026.08-beta" }))).toThrow();
    expect(() => manifestSchema.parse(manifest({ version: "" }))).toThrow();
  });

  it("accepts the same shapes for minVersion, defaulting when absent", () => {
    expect(manifestSchema.parse(manifest()).minVersion).toBe("0.0.0");
    expect(manifestSchema.parse(manifest({ minVersion: "2026.28" })).minVersion).toBe("2026.28");
    expect(manifestSchema.parse(manifest({ minVersion: "2026.08.19.3" })).minVersion).toBe("2026.08.19.3");
    expect(() => manifestSchema.parse(manifest({ minVersion: "2026" }))).toThrow();
  });
});

describe("compareVersions", () => {
  it("ranks the MM.N to MICRO crossover so a micro release wins", () => {
    // The whole point of starting the micro at 28: it must outrank the last
    // month component (08) so instances see 2026.28 as newer than 2026.08.27.
    expect(compareVersions("2026.08.27", "2026.28")).toBe(-1);
    expect(compareVersions("2026.28", "2026.29")).toBe(-1);
    expect(compareVersions("2026.28", "2026.08.27")).toBe(1);
    expect(compareVersions("2026.29", "2026.28")).toBe(1);
  });

  it("still ranks the old three-component releases against each other", () => {
    expect(compareVersions("2026.08.26", "2026.08.27")).toBe(-1);
    expect(compareVersions("2026.08.27", "2026.08.26")).toBe(1);
  });

  it("ranks four-component releases in both directions", () => {
    expect(compareVersions("2026.08.19.3", "2026.08.19.5")).toBe(-1);
    expect(compareVersions("2026.08.19.5", "2026.08.19.3")).toBe(1);
    expect(compareVersions("2026.08.19.3", "2026.08.20")).toBe(-1);
    expect(compareVersions("2026.08.20", "2026.08.19.3")).toBe(1);
  });

  it("pads missing components with zero so a shorter version is not automatically older", () => {
    expect(compareVersions("2026.28", "2026.28.0")).toBe(0);
    expect(compareVersions("2026.28", "2026.28.1")).toBe(-1);
    expect(compareVersions("2026.28", "2026.28")).toBe(0);
  });
});

describe("checkForUpdates", () => {
  beforeEach(() => {
    upsert.mockReset();
  });

  it("reports an update when a 2026.08.27 instance polls a two-component manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => manifest(),
      })),
    );

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.currentVersion).toBe("2026.08.27");
    expect(result.latestVersion).toBe("2026.28");
    expect(result.updateAvailable).toBe(true);

    const persisted = upsert.mock.calls[0]?.[0]?.update;
    expect(persisted).toMatchObject({
      latestVersion: "2026.28",
      latestChangelog: "Something changed",
      updateAvailable: true,
    });

    vi.unstubAllGlobals();
  });
});
