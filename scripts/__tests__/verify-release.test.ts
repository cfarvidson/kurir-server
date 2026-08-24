import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SCRIPT = path.resolve(__dirname, "../verify-release.sh");
const WORKFLOW = path.resolve(
  __dirname,
  "../../.github/workflows/docker-publish.yml",
);
const PROMOTE_WORKFLOW = path.resolve(
  __dirname,
  "../../.github/workflows/promote-latest.yml",
);

const VERSION = "2026.32";
const STABLE = "2026.31";

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

function writeTree(
  latest: Record<string, unknown>,
  opts: { pkgVersion?: string; changelogHead?: string } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-release-"));
  const pkgVersion = opts.pkgVersion ?? VERSION;
  const changelogHead = opts.changelogHead ?? VERSION;
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ version: pkgVersion }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify(latest, null, 2) + "\n",
  );
  writeFileSync(
    path.join(dir, "changelog.json"),
    JSON.stringify(
      [
        {
          version: changelogHead,
          date: "2026-08-24",
          changes: ["head"],
        },
        { version: STABLE, date: "2026-08-24", changes: ["stable"] },
        { version: "2026.29", date: "2026-08-24", changes: ["older"] },
      ],
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(dir, "CHANGELOG.md"),
    `# Changelog\n\n## [Unreleased]\n\n## [v${changelogHead}] - 2026-08-24\n\n- head\n`,
  );
  return dir;
}

function run(
  dir: string,
  args: string[],
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execFileSync("sh", [SCRIPT, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    return { ok: true, stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? null,
    };
  }
}

const betaManifest = {
  ...pointer(STABLE, "last stable"),
  beta: pointer(VERSION, "pending beta"),
};

const stableManifest = pointer(VERSION, "now stable");

describe("verify-release.sh beta mode", () => {
  it("passes when package.json, changelogs, and latest.json.beta match the tag and top-level is older", () => {
    const dir = writeTree(betaManifest);
    const result = run(dir, ["--mode", "beta", `v${VERSION}`]);
    expect(result.stderr).toBe("");
    expect(result.ok).toBe(true);
    expect(result.stdout).toMatch(/complete/);
  });

  it("is the default mode so a tag build can omit --mode", () => {
    const dir = writeTree(betaManifest);
    const result = run(dir, [`v${VERSION}`]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toMatch(/complete/);
  });

  it("blocks an incomplete commit that never wrote latest.json.beta", () => {
    const dir = writeTree(pointer(STABLE, "last stable"));
    const result = run(dir, ["--mode", "beta", `v${VERSION}`]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/latest\.json\.beta/);
  });

  it("blocks a tag that bumped the top-level pointer instead of only beta", () => {
    const dir = writeTree(pointer(VERSION, "accidentally stable"));
    const result = run(dir, ["--mode", "beta", `v${VERSION}`]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/top-level/);
  });

  it("blocks when package.json was not bumped", () => {
    const dir = writeTree(betaManifest, { pkgVersion: STABLE });
    const result = run(dir, ["--mode", "beta", `v${VERSION}`]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/package\.json/);
  });
});

describe("verify-release.sh mark-stable mode", () => {
  it("passes when the top-level pointer matches beta", () => {
    const dir = writeTree({
      ...pointer(VERSION, "now stable"),
      beta: pointer(VERSION, "now stable"),
    });
    const result = run(dir, ["--mode", "mark-stable", `v${VERSION}`]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toMatch(/complete/);
  });

  it("passes when beta is omitted after being copied onto the top-level pointer", () => {
    const dir = writeTree(stableManifest);
    const result = run(dir, ["--mode", "mark-stable", `v${VERSION}`]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toMatch(/complete/);
  });

  it("blocks when top-level still points at the previous stable", () => {
    const dir = writeTree(betaManifest);
    const result = run(dir, ["--mode", "mark-stable", `v${VERSION}`]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/top-level/);
  });
});

describe("release image tags", () => {
  it("does not move :latest when a version tag is published", () => {
    const yml = readFileSync(WORKFLOW, "utf8");
    expect(yml).not.toMatch(/type=raw,value=latest/);
  });

  it("promotes :latest from an already-published versioned image without rebuilding", () => {
    const yml = readFileSync(PROMOTE_WORKFLOW, "utf8");
    expect(yml).toMatch(/imagetools create/);
    expect(yml).toMatch(/verify-release\.sh --mode mark-stable/);
    expect(yml).not.toMatch(/docker\/build-push-action/);
  });
});
