#!/usr/bin/env node
/**
 * Write the beta pointer, or copy it onto the stable pointer.
 *
 *   node scripts/release-manifest.mjs write-beta \
 *     --version 2026.32 --changelog "..." --released-at 2026-08-24T00:00:00Z
 *   node scripts/release-manifest.mjs mark-stable
 *
 * Reads and writes latest.json in the current working directory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const IMAGE = "ghcr.io/cfarvidson/kurir-server";

function readLatest() {
  return JSON.parse(readFileSync("latest.json", "utf8"));
}

function writeLatest(obj) {
  writeFileSync("latest.json", JSON.stringify(obj, null, 2) + "\n");
}

function withoutBeta(obj) {
  const { beta: _beta, ...rest } = obj;
  return rest;
}

function compareVersions(a, b) {
  const partsA = String(a).split(".").map(Number);
  const partsB = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function pointer(version, changelog, releasedAt) {
  return {
    version,
    image: `${IMAGE}:v${version}`,
    releaseUrl: `https://github.com/cfarvidson/kurir-server/releases/tag/v${version}`,
    changelog,
    minVersion: "0.0.0",
    releasedAt,
  };
}

const [command, ...rest] = process.argv.slice(2);

if (command === "write-beta") {
  const { values } = parseArgs({
    args: rest,
    options: {
      version: { type: "string" },
      changelog: { type: "string" },
      "released-at": { type: "string" },
    },
  });
  if (!values.version || !values.changelog || !values["released-at"]) {
    console.error(
      "usage: release-manifest.mjs write-beta --version YYYY.MICRO --changelog TEXT --released-at ISO",
    );
    process.exit(2);
  }
  const latest = readLatest();
  writeLatest({
    ...withoutBeta(latest),
    beta: pointer(values.version, values.changelog, values["released-at"]),
  });
} else if (command === "mark-stable") {
  const latest = readLatest();
  if (!latest.beta || typeof latest.beta !== "object") {
    console.error("latest.json has no beta pointer to promote");
    process.exit(1);
  }
  if (compareVersions(latest.beta.version, latest.version) <= 0) {
    console.error("beta is not newer than the top-level pointer");
    process.exit(1);
  }
  writeLatest(withoutBeta(latest.beta));
} else {
  console.error("usage: release-manifest.mjs write-beta|mark-stable");
  process.exit(2);
}
