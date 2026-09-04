import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import pkg from "@/../package.json";
import {
  checkForUpdates,
  isRunningAheadOfStable,
} from "@/lib/updates/version-checker";
import { checkUpdaterHealth } from "@/lib/updates/updater-health";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [settings, history, updater] = await Promise.all([
    db.systemSettings.upsert({
      where: { id: "singleton" },
      create: {},
      update: {},
    }),
    db.updateLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    checkUpdaterHealth(),
  ]);

  const updateChannel = settings.updateChannel === "beta" ? "beta" : "stable";

  return NextResponse.json({
    currentVersion: pkg.version,
    updateAvailable: settings.updateAvailable,
    runningAheadOfStable: isRunningAheadOfStable(
      pkg.version,
      settings.latestVersion,
      updateChannel,
    ),
    latestVersion: settings.latestVersion,
    latestReleaseUrl: settings.latestReleaseUrl,
    latestChangelog: settings.latestChangelog,
    lastUpdateCheck: settings.lastUpdateCheck?.toISOString() ?? null,
    imageAvailable: settings.imageAvailable,
    imageCheckedAt: settings.imageCheckedAt?.toISOString() ?? null,
    updateMode: settings.updateMode,
    updateChannel,
    updater,
    history: history.map((h) => ({
      id: h.id,
      createdAt: h.createdAt.toISOString(),
      fromVersion: h.fromVersion,
      toVersion: h.toVersion,
      status: h.status,
      error: h.error,
      durationMs: h.durationMs,
      triggeredBy: h.triggeredBy,
      completedAt: h.completedAt?.toISOString() ?? null,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { updateMode, updateChannel } = body as {
    updateMode?: unknown;
    updateChannel?: unknown;
  };

  const data: { updateMode?: string; updateChannel?: string } = {};

  if (updateMode !== undefined) {
    if (
      typeof updateMode !== "string" ||
      !["off", "notify", "auto"].includes(updateMode)
    ) {
      return NextResponse.json(
        { error: "Invalid update mode. Must be one of: off, notify, auto" },
        { status: 400 },
      );
    }
    data.updateMode = updateMode;
  }

  if (updateChannel !== undefined) {
    if (
      typeof updateChannel !== "string" ||
      !["stable", "beta"].includes(updateChannel)
    ) {
      return NextResponse.json(
        { error: "Invalid update channel. Must be one of: stable, beta" },
        { status: 400 },
      );
    }
    data.updateChannel = updateChannel;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Expected updateMode or updateChannel" },
      { status: 400 },
    );
  }

  const settings = await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: data,
    update: data,
  });

  // Re-read the manifest on the new channel so latestVersion / updateAvailable
  // are not left on the previous pointer (a stable instance would otherwise
  // still offer the beta until the next poll).
  if (data.updateChannel !== undefined) {
    await checkForUpdates();
  }

  return NextResponse.json({
    updateMode: settings.updateMode,
    updateChannel: settings.updateChannel,
  });
}
