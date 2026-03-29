import { spawn } from "child_process";
import { join } from "path";
import { db } from "@/lib/db";
import pkg from "@/../package.json";

export interface UpdateResult {
  started: boolean;
  error?: string;
  logId?: string;
}

/**
 * Start the update process. Returns immediately with a
 * log entry ID — the actual update runs as a detached process.
 */
export async function startUpdate(
  targetVersion: string,
  triggeredBy: "manual" | "auto" = "manual",
): Promise<UpdateResult> {
  // Check for in-progress update
  const inProgress = await db.updateLog.findFirst({
    where: {
      status: { in: ["started", "pulling", "restarting", "verifying"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (inProgress) {
    return { started: false, error: "An update is already in progress" };
  }

  // Create log entry
  const log = await db.updateLog.create({
    data: {
      fromVersion: pkg.version,
      toVersion: targetVersion,
      status: "started",
      triggeredBy,
    },
  });

  // Spawn detached update script
  const scriptPath = join(process.cwd(), "scripts", "kurir-update.sh");
  const child = spawn("bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      UPDATE_LOG_ID: log.id,
    },
  });
  child.unref();

  return { started: true, logId: log.id };
}

/**
 * Trigger rollback to previous version.
 */
export async function startRollback(): Promise<UpdateResult> {
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

  // Use rollback-tagged image
  const scriptPath = join(process.cwd(), "scripts", "kurir-update.sh");
  const child = spawn("bash", [scriptPath, "--rollback"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      UPDATE_LOG_ID: log.id,
      ROLLBACK: "true",
    },
  });
  child.unref();

  return { started: true, logId: log.id };
}
