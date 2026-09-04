import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { manifestSchema, checkForUpdates } from "../version-checker";
import { compareVersions } from "../compare-versions";
import handwrittenWithBeta from "./fixtures/latest-with-beta.json";

const { upsert, findFirst, checkImageExists, pkg } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findFirst: vi.fn(),
  checkImageExists: vi.fn(),
  pkg: { version: "2026.08.27" },
}));

vi.mock("../image-availability", () => ({
  checkImageExists: (...args: unknown[]) => checkImageExists(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    systemSettings: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

vi.mock("@/../package.json", () => ({ default: pkg }));

const pointer = (
  version: string,
  changelog: string,
  overrides: Record<string, unknown> = {},
) => ({
  version,
  image: `ghcr.io/cfarvidson/kurir-server:v${version}`,
  releaseUrl: `https://github.com/cfarvidson/kurir-server/releases/tag/v${version}`,
  changelog,
  minVersion: "0.0.0",
  releasedAt: "2026-08-24T00:00:00Z",
  ...overrides,
});

const manifest = (overrides: Record<string, unknown> = {}) =>
  pointer("2026.28", "Something changed", {
    releasedAt: "2026-08-23T21:00:00Z",
    ...overrides,
  });

const mixedManifest = {
  ...pointer("2026.29", "stable changelog"),
  beta: pointer("2026.30", "beta changelog", {
    releasedAt: "2026-08-25T00:00:00Z",
  }),
};

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => body,
    })),
  );
}

function persisted() {
  return upsert.mock.calls[0]?.[0]?.update as
    Record<string, unknown> | undefined;
}

describe("manifestSchema", () => {
  it("accepts a two-component YYYY.MICRO manifest", () => {
    const parsed = manifestSchema.parse(manifest());
    expect(parsed.version).toBe("2026.28");
    expect(parsed.image).toBe("ghcr.io/cfarvidson/kurir-server:v2026.28");
  });

  it("still accepts the three- and four-component versions already in the field", () => {
    expect(
      manifestSchema.parse(manifest({ version: "2026.08.27" })).version,
    ).toBe("2026.08.27");
    expect(
      manifestSchema.parse(manifest({ version: "2026.08.19.3" })).version,
    ).toBe("2026.08.19.3");
  });

  it("rejects versions that are not two to four numeric components", () => {
    expect(() => manifestSchema.parse(manifest({ version: "2026" }))).toThrow();
    expect(() =>
      manifestSchema.parse(manifest({ version: "2026.1.2.3.4" })),
    ).toThrow();
    expect(() =>
      manifestSchema.parse(manifest({ version: "2026.08-beta" })),
    ).toThrow();
    expect(() => manifestSchema.parse(manifest({ version: "" }))).toThrow();
  });

  it("accepts the same shapes for minVersion, defaulting when absent", () => {
    expect(manifestSchema.parse(manifest()).minVersion).toBe("0.0.0");
    expect(
      manifestSchema.parse(manifest({ minVersion: "2026.28" })).minVersion,
    ).toBe("2026.28");
    expect(
      manifestSchema.parse(manifest({ minVersion: "2026.08.19.3" })).minVersion,
    ).toBe("2026.08.19.3");
    expect(() =>
      manifestSchema.parse(manifest({ minVersion: "2026" })),
    ).toThrow();
  });

  it("accepts a handwritten manifest with top-level 2026.29 and beta 2026.30", () => {
    const parsed = manifestSchema.parse(handwrittenWithBeta);
    expect(parsed.version).toBe("2026.29");
    expect(parsed.beta?.version).toBe("2026.30");
    expect(parsed.beta?.changelog).toBe("beta changelog");
  });

  it("accepts the same file without a beta object", () => {
    const { beta: _beta, ...stableOnly } = handwrittenWithBeta;
    const parsed = manifestSchema.parse(stableOnly);
    expect(parsed.version).toBe("2026.29");
    expect(parsed.beta).toBeUndefined();
  });

  it("rejects a suffix version on the beta pointer", () => {
    expect(() =>
      manifestSchema.parse({
        ...mixedManifest,
        beta: pointer("2026.30-beta.1", "nope"),
      }),
    ).toThrow();
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
    findFirst.mockReset();
    checkImageExists.mockReset().mockResolvedValue(true);
    pkg.version = "2026.08.27";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "stable",
    });
  });

  it("reports an update when a 2026.08.27 instance polls a two-component manifest", async () => {
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.currentVersion).toBe("2026.08.27");
    expect(result.latestVersion).toBe("2026.28");
    expect(result.updateAvailable).toBe(true);
    expect(persisted()).toMatchObject({
      latestVersion: "2026.28",
      latestChangelog: "Something changed",
      updateAvailable: true,
    });

    vi.unstubAllGlobals();
  });

  it("treats a missing channel setting as stable", async () => {
    pkg.version = "2026.29";
    findFirst.mockResolvedValue({ updateManifestUrl: null });
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("2026.29");
    expect(result.updateAvailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it("uses the top-level pointer on the stable channel even when beta is newer", async () => {
    pkg.version = "2026.29";
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("2026.29");
    expect(result.updateAvailable).toBe(false);
    expect(persisted()).toMatchObject({
      latestVersion: "2026.29",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.29",
      latestChangelog: "stable changelog",
      updateAvailable: false,
    });

    vi.unstubAllGlobals();
  });

  it("uses the beta pointer on the beta channel when it is ahead of stable", async () => {
    pkg.version = "2026.29";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "beta",
    });
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("2026.30");
    expect(result.updateAvailable).toBe(true);
    expect(persisted()).toMatchObject({
      latestVersion: "2026.30",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.30",
      latestReleaseUrl:
        "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.30",
      latestChangelog: "beta changelog",
      updateAvailable: true,
    });

    vi.unstubAllGlobals();
  });

  it("falls back to the top-level pointer when beta is missing", async () => {
    pkg.version = "2026.29";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "beta",
    });
    const { beta: _beta, ...stableOnly } = mixedManifest;
    stubFetch(stableOnly);

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("2026.29");
    expect(result.updateAvailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it("falls back to the top-level pointer when beta is older or equal", async () => {
    pkg.version = "2026.29";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "beta",
    });
    stubFetch({
      ...mixedManifest,
      beta: pointer("2026.29", "same as stable"),
    });

    const older = await checkForUpdates();
    expect(older.latestVersion).toBe("2026.29");
    expect(older.updateAvailable).toBe(false);

    upsert.mockReset();
    stubFetch({
      ...mixedManifest,
      beta: pointer("2026.28", "older than stable"),
    });

    const behind = await checkForUpdates();
    expect(behind.latestVersion).toBe("2026.29");
    expect(behind.updateAvailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it("changes which pointer is used when the channel is flipped", async () => {
    pkg.version = "2026.29";
    stubFetch(mixedManifest);

    const onStable = await checkForUpdates();
    expect(onStable.latestVersion).toBe("2026.29");
    expect(onStable.updateAvailable).toBe(false);

    upsert.mockReset();
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "beta",
    });

    const onBeta = await checkForUpdates();
    expect(onBeta.latestVersion).toBe("2026.30");
    expect(onBeta.updateAvailable).toBe(true);

    vi.unstubAllGlobals();
  });

  it("reports running ahead of stable when betas are off and current is an unmarked version", async () => {
    pkg.version = "2026.30";
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("2026.29");
    expect(result.updateAvailable).toBe(false);
    expect(result.runningAheadOfStable).toBe(true);

    vi.unstubAllGlobals();
  });

  it("does not report ahead of stable for an ordinary stable instance", async () => {
    pkg.version = "2026.29";
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.runningAheadOfStable).toBe(false);

    vi.unstubAllGlobals();
  });

  it("does not report ahead of stable while the instance is still on the beta channel", async () => {
    pkg.version = "2026.30";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "beta",
    });
    stubFetch(mixedManifest);

    const result = await checkForUpdates();

    expect(result.latestVersion).toBe("2026.30");
    expect(result.updateAvailable).toBe(false);
    expect(result.runningAheadOfStable).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe("checkForUpdates image availability", () => {
  beforeEach(() => {
    upsert.mockReset();
    findFirst.mockReset();
    checkImageExists.mockReset();
    pkg.version = "2026.08.27";
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "stable",
      latestImageTag: null,
      imageAvailable: null,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("probes the registry for the pointer image and persists the verdict", async () => {
    checkImageExists.mockResolvedValue(true);
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(checkImageExists).toHaveBeenCalledWith(
      "ghcr.io/cfarvidson/kurir-server:v2026.28",
    );
    expect(result.imageAvailable).toBe(true);
    expect(persisted()).toMatchObject({ imageAvailable: true });
    expect(persisted()?.imageCheckedAt).toBeInstanceOf(Date);
  });

  it("persists false when the tag is not published yet", async () => {
    checkImageExists.mockResolvedValue(false);
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(result.imageAvailable).toBe(false);
    expect(persisted()).toMatchObject({ imageAvailable: false });
  });

  it("skips the probe and clears the fields when nothing is installable", async () => {
    pkg.version = "2026.28";
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(checkImageExists).not.toHaveBeenCalled();
    expect(result.imageAvailable).toBeNull();
    expect(persisted()).toMatchObject({
      imageAvailable: null,
      imageCheckedAt: null,
    });
  });

  it("keeps the previous verdict for the same image when the probe fails", async () => {
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "stable",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.28",
      imageAvailable: true,
    });
    checkImageExists.mockRejectedValue(new Error("ECONNRESET"));
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.imageAvailable).toBe(true);
    expect(persisted()).not.toHaveProperty("imageAvailable");
    expect(persisted()).toMatchObject({ updateAvailable: true });
  });

  it("resets to unknown when the probe fails for a new image", async () => {
    findFirst.mockResolvedValue({
      updateManifestUrl: null,
      updateChannel: "stable",
      latestImageTag: "ghcr.io/cfarvidson/kurir-server:v2026.08.28",
      imageAvailable: true,
    });
    checkImageExists.mockRejectedValue(new Error("ECONNRESET"));
    stubFetch(manifest());

    const result = await checkForUpdates();

    expect(result.imageAvailable).toBeNull();
    expect(persisted()).toMatchObject({
      imageAvailable: null,
      imageCheckedAt: null,
    });
  });
});
