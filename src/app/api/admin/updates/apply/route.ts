import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import pkg from "@/../package.json";
import { startUpdate } from "@/lib/updates/update-executor";
import { isRunningAheadOfStable } from "@/lib/updates/version-checker";
import { checkImageExists } from "@/lib/updates/image-availability";

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });

  const ahead = isRunningAheadOfStable(
    pkg.version,
    settings?.latestVersion,
    settings?.updateChannel,
  );

  if ((!settings?.updateAvailable && !ahead) || !settings?.latestVersion) {
    return NextResponse.json({ error: "No update available" }, { status: 400 });
  }

  // Re-verify right before starting: the page may be showing a check from
  // minutes ago, and a doomed pull would otherwise land as a failed run.
  if (settings.latestImageTag) {
    let available: boolean;
    try {
      available = await checkImageExists(settings.latestImageTag);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Could not verify that the Docker image is published (${message})` },
        { status: 503 },
      );
    }

    await db.systemSettings.update({
      where: { id: "singleton" },
      data: { imageAvailable: available, imageCheckedAt: new Date() },
    });

    if (!available) {
      return NextResponse.json(
        {
          error: `Docker image for v${settings.latestVersion} is not published yet`,
        },
        { status: 409 },
      );
    }
  }

  const result = await startUpdate(settings.latestVersion, "manual");

  if (!result.started) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(
    { message: "Update started", logId: result.logId },
    { status: 202 },
  );
}
