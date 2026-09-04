import { db } from "@/lib/db";
import pkg from "@/../package.json";
import { checkUpdaterHealth } from "@/lib/updates/updater-health";
import {
  ACTIVE_UPDATE_STATUSES,
  UPDATER_REFRESH_COMMAND,
} from "@/lib/updates/constants";

export interface UpdateResult {
  started: boolean;
  error?: string;
  logId?: string;
}

const UPDATER_URL = process.env.UPDATER_URL ?? "http://updater:8080";
const UPDATER_TOKEN = process.env.UPDATER_TOKEN ?? "";

async function callUpdater(
  path: "/apply" | "/rollback",
  logId: string,
  imageRef?: string,
  toVersion?: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!UPDATER_TOKEN) {
    return {
      ok: false,
      error:
        "Updater is not configured (UPDATER_TOKEN missing). Re-run install.sh to generate it.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${UPDATER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Updater-Token": UPDATER_TOKEN,
      },
      body: JSON.stringify({
        logId,
        ...(imageRef ? { imageRef } : {}),
        ...(toVersion ? { toVersion } : {}),
      }),
      signal: controller.signal,
    });

    if (res.status === 202) {
      return { ok: true };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      status: res.status,
      error: body.error ?? `updater returned ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `updater unreachable: ${err.message}`
          : "updater unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Start the update process. Creates the UpdateLog row, then hands the work
 * off to the kurir-updater sidecar over HTTP. The updater runs outside the
 * app container so restarting the app doesn't kill it mid-update.
 */
export async function startUpdate(
  targetVersion: string,
  triggeredBy: "manual" | "auto" = "manual",
): Promise<UpdateResult> {
  const inProgress = await db.updateLog.findFirst({
    where: {
      status: { in: [...ACTIVE_UPDATE_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (inProgress) {
    return { started: false, error: "An update is already in progress" };
  }

  // Pin the exact release image from the manifest. `docker compose pull`
  // would grab whatever `:latest` happens to point at, which races the
  // release pipeline (a pre-release main build can sit there before the tag
  // build finishes — new code, stale version stamp, missing migrations).
  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  const imageRef =
    settings?.latestVersion === targetVersion
      ? (settings.latestImageTag ?? undefined)
      : undefined;

  const log = await db.updateLog.create({
    data: {
      fromVersion: pkg.version,
      toVersion: targetVersion,
      status: "started",
      triggeredBy,
    },
  });

  // A sidecar that predates imageRef pinning would pull whatever `:latest`
  // points at, health-check the old code, and report success — refuse and
  // tell the operator how to refresh it (kurir-ios#57).
  const updaterHealth = await checkUpdaterHealth();
  const result = updaterHealth.stale
    ? {
        ok: false as const,
        error:
          "Updater sidecar is too old to safely apply updates (it ignores " +
          "the pinned release image). Refresh it on the server: " +
          UPDATER_REFRESH_COMMAND,
      }
    : await callUpdater("/apply", log.id, imageRef, targetVersion);
  if (!result.ok) {
    await db.updateLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        error: result.error,
        completedAt: new Date(),
        durationMs: 0,
      },
    });
    return { started: false, error: result.error };
  }

  return { started: true, logId: log.id };
}

/**
 * Trigger rollback to the previous version. Delegates to the updater sidecar
 * which keeps the previous image tagged as `kurir-server:rollback` after each
 * successful update.
 */
export async function startRollback(): Promise<UpdateResult> {
  const inProgress = await db.updateLog.findFirst({
    where: {
      status: { in: [...ACTIVE_UPDATE_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (inProgress) {
    return { started: false, error: "An update is already in progress" };
  }

  const lastSuccessful = await db.updateLog.findFirst({
    where: { status: "success" },
    orderBy: { createdAt: "desc" },
  });

  const log = await db.updateLog.create({
    data: {
      fromVersion: pkg.version,
      toVersion: lastSuccessful?.fromVersion ?? "unknown",
      status: "started",
      triggeredBy: "manual",
    },
  });

  // Rollback is deliberately not gated on sidecar staleness — it is the
  // emergency path. Pass the expected version so a new sidecar can verify.
  const rollbackTarget =
    lastSuccessful?.fromVersion && lastSuccessful.fromVersion !== "unknown"
      ? lastSuccessful.fromVersion
      : undefined;
  const result = await callUpdater(
    "/rollback",
    log.id,
    undefined,
    rollbackTarget,
  );
  if (!result.ok) {
    await db.updateLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        error: result.error,
        completedAt: new Date(),
        durationMs: 0,
      },
    });
    return { started: false, error: result.error };
  }

  return { started: true, logId: log.id };
}
