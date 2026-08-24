import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SCRIPT = path.resolve(__dirname, "../release-manifest.mjs");

function pointer(version: string, changelog: string) {
  return {
    version,
    image: `ghcr.io/cfarvidson/kurir-server:v${version}`,
    releaseUrl: `https://github.com/cfarvidson/kurir-server/releases/tag/v${version}`,
    changelog,
    minVersion: "0.0.0",
    releasedAt: "2026-08-24T00:00:00Z",
  };
}

function seed(latest: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-manifest-"));
  writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify(latest, null, 2) + "\n",
  );
  return dir;
}

function readLatest(dir: string) {
  return JSON.parse(readFileSync(path.join(dir, "latest.json"), "utf8"));
}

function run(dir: string, args: string[]) {
  return execFileSync("node", [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

describe("release-manifest write-beta", () => {
  it("writes latest.json.beta and leaves the top-level pointer on the last stable", () => {
    const dir = seed(pointer("2026.31", "last stable"));
    run(dir, [
      "write-beta",
      "--version",
      "2026.32",
      "--changelog",
      "pending beta",
      "--released-at",
      "2026-08-25T00:00:00Z",
    ]);
    const latest = readLatest(dir);
    expect(latest.version).toBe("2026.31");
    expect(latest.image).toBe("ghcr.io/cfarvidson/kurir-server:v2026.31");
    expect(latest.changelog).toBe("last stable");
    expect(latest.beta).toEqual({
      version: "2026.32",
      image: "ghcr.io/cfarvidson/kurir-server:v2026.32",
      releaseUrl:
        "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.32",
      changelog: "pending beta",
      minVersion: "0.0.0",
      releasedAt: "2026-08-25T00:00:00Z",
    });
  });
});

describe("release-manifest mark-stable", () => {
  it("refuses to promote when beta is not newer than the top-level pointer", () => {
    const dir = seed({
      ...pointer("2026.31", "stable"),
      beta: pointer("2026.31", "same"),
    });
    try {
      run(dir, ["mark-stable"]);
      throw new Error("expected mark-stable to fail");
    } catch (err) {
      expect((err as { stderr?: string }).stderr).toMatch(/not newer/);
    }
    expect(readLatest(dir).version).toBe("2026.31");
  });

  it("copies beta onto the top-level fields and drops the pending beta object", () => {
    const dir = seed({
      ...pointer("2026.31", "last stable"),
      beta: pointer("2026.32", "pending beta"),
    });
    run(dir, ["mark-stable"]);
    const latest = readLatest(dir);
    expect(latest.version).toBe("2026.32");
    expect(latest.image).toBe("ghcr.io/cfarvidson/kurir-server:v2026.32");
    expect(latest.changelog).toBe("pending beta");
    expect(latest.releaseUrl).toBe(
      "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.32",
    );
    expect(latest.beta).toBeUndefined();
  });
});
