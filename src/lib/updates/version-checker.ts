import { z } from "zod";
import { db } from "@/lib/db";
import pkg from "@/../package.json";
import { DEFAULT_MANIFEST_URL } from "./constants";
import { checkImageExists } from "./image-availability";
import { compareVersions } from "./compare-versions";

export { compareVersions };

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

const pointerSchema = z.object({
  version: z.string().regex(versionPattern),
  image: z.string().min(1),
  releaseUrl: z.url(),
  changelog: z.string(),
  minVersion: z.string().regex(versionPattern).optional().default("0.0.0"),
  releasedAt: z.string(),
});

export const manifestSchema = pointerSchema.extend({
  beta: pointerSchema.nullish(),
});

type UpdateChannel = "stable" | "beta";

function asPointer(parsed: z.infer<typeof pointerSchema>): VersionManifest {
  return {
    version: parsed.version,
    image: parsed.image,
    releaseUrl: parsed.releaseUrl,
    changelog: parsed.changelog,
    minVersion: parsed.minVersion,
    releasedAt: parsed.releasedAt,
  };
}

/**
 * Stable reads the top-level object. Beta reads `beta` when that version is
 * newer than top-level; a missing, equal, or older `beta` falls back.
 */
function selectManifestPointer(
  manifest: z.infer<typeof manifestSchema>,
  channel: UpdateChannel,
): VersionManifest {
  const stable = asPointer(manifest);
  if (
    channel === "beta" &&
    manifest.beta &&
    compareVersions(manifest.version, manifest.beta.version) < 0
  ) {
    return asPointer(manifest.beta);
  }
  return stable;
}

function readChannel(value: string | null | undefined): UpdateChannel {
  return value === "beta" ? "beta" : "stable";
}

/**
 * Running a tagged version that has not been copied onto the top-level
 * latest.json pointer, with Install betas off. The update check only
 * offers a strictly newer version, so this is otherwise reported as
 * "Up to Date".
 */
export function isRunningAheadOfStable(
  currentVersion: string,
  latestVersion: string | null | undefined,
  channel: string | null | undefined,
): boolean {
  if (!latestVersion) return false;
  if (readChannel(channel) !== "stable") return false;
  return compareVersions(currentVersion, latestVersion) > 0;
}

function isValidManifestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
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
  runningAheadOfStable: boolean;
  /** null when there is nothing to install or the registry probe failed */
  imageAvailable: boolean | null;
  error?: string;
}> {
  const currentVersion: string = pkg.version;

  try {
    // Read the manifest URL from SystemSettings, falling back to the default
    const settings = await db.systemSettings.findFirst();
    const channel = readChannel(settings?.updateChannel);
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
    const pointer = selectManifestPointer(manifest, channel);
    const latestVersion = pointer.version;
    const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;
    const runningAheadOfStable = isRunningAheadOfStable(
      currentVersion,
      latestVersion,
      channel,
    );

    // Only probe the registry when there is something to install. A failed
    // probe keeps the previous answer for the same image; for a new image it
    // resets to null so a stale "verified" never carries over.
    const imageFields: {
      imageAvailable?: boolean | null;
      imageCheckedAt?: Date | null;
    } = {};
    if (updateAvailable || runningAheadOfStable) {
      try {
        imageFields.imageAvailable = await checkImageExists(pointer.image);
        imageFields.imageCheckedAt = new Date();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[update-checker] Could not verify image ${pointer.image}: ${message}`,
        );
        if (settings?.latestImageTag !== pointer.image) {
          imageFields.imageAvailable = null;
          imageFields.imageCheckedAt = null;
        }
      }
    } else {
      imageFields.imageAvailable = null;
      imageFields.imageCheckedAt = null;
    }

    const fields = {
      latestVersion,
      latestImageTag: pointer.image,
      latestReleaseUrl: pointer.releaseUrl,
      latestChangelog: pointer.changelog,
      updateAvailable,
      lastUpdateCheck: new Date(),
      ...imageFields,
    };

    // Persist the result in SystemSettings
    await db.systemSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...fields },
      update: fields,
    });

    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      runningAheadOfStable,
      imageAvailable:
        imageFields.imageAvailable !== undefined
          ? imageFields.imageAvailable
          : (settings?.imageAvailable ?? null),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[update-checker] Failed to check for updates: ${message}`);

    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: "unknown",
      runningAheadOfStable: false,
      imageAvailable: null,
      error: message,
    };
  }
}
