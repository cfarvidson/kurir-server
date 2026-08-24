import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import pkg from "@/../package.json";
import { startUpdate } from "@/lib/updates/update-executor";
import { isRunningAheadOfStable } from "@/lib/updates/version-checker";

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

  const result = await startUpdate(settings.latestVersion, "manual");

  if (!result.started) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(
    { message: "Update started", logId: result.logId },
    { status: 202 },
  );
}
