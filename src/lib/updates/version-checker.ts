import { z } from "zod";
import { db } from "@/lib/db";
import pkg from "@/../package.json";
import { DEFAULT_MANIFEST_URL } from "./constants";

export interface VersionManifest {
  version: string;
  image: string;
  releaseUrl: string;
  changelog: string;
  minVersion: string;
  releasedAt: string;
}

/**
 * Two to four numeric components: `YYYY.MICRO` (the current format),
 * `YYYY.MM.N` and the historical four-part `YYYY.MM.DD.N` still sitting in
 * old manifests. Anchored at both ends so a version is digits and dots only.
 */
const versionPattern = /^\d+(\.\d+){1,3}$/;

export const manifestSchema = z.object({
  version: z.string().regex(versionPattern),
  image: z.string().min(1),
  releaseUrl: z.url(),
  changelog: z.string(),
  minVersion: z
    .string()
    .regex(versionPattern)
    .optional()
    .default("0.0.0"),
  releasedAt: z.string(),
});

function isValidManifestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Compare two CalVer strings component by component, padding the shorter one
 * with zeroes. Returns -1 if a < b, 0 if equal, 1 if a > b.
 *
 * The `YYYY.MM.N` -> `YYYY.MICRO` crossover needs no special case here: the
 * first micro was picked to outrank the last month component, so
 * `2026.08.27` < `2026.28` is just `8 < 28` on the second component. That is
 * also why a micro cannot restart at 1 mid-year.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

/**
 * Check for available updates by fetching the remote version manifest
 * and comparing against the current package.json version.
 *
 * Updates SystemSettings with the result and returns a summary.
 */
export async function checkForUpdates(): Promise<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  error?: string;
}> {
  const currentVersion: string = pkg.version;

  try {
    // Read the manifest URL from SystemSettings, falling back to the default
    const settings = await db.systemSettings.findFirst();
    const manifestUrl = settings?.updateManifestUrl ?? DEFAULT_MANIFEST_URL;

    if (!isValidManifestUrl(manifestUrl)) {
      throw new Error(`Invalid manifest URL: ${manifestUrl}`);
    }

    // Fetch with a 10-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(manifestUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `Manifest fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const raw = await response.json();
    const manifest = manifestSchema.parse(raw);
    const latestVersion = manifest.version;
    const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;

    // Persist the result in SystemSettings
    await db.systemSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        latestVersion,
        latestImageTag: manifest.image,
        latestReleaseUrl: manifest.releaseUrl,
        latestChangelog: manifest.changelog,
        updateAvailable,
        lastUpdateCheck: new Date(),
      },
      update: {
        latestVersion,
        latestImageTag: manifest.image,
        latestReleaseUrl: manifest.releaseUrl,
        latestChangelog: manifest.changelog,
        updateAvailable,
        lastUpdateCheck: new Date(),
      },
    });

    return { updateAvailable, currentVersion, latestVersion };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[update-checker] Failed to check for updates: ${message}`);

    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: "unknown",
      error: message,
    };
  }
}
