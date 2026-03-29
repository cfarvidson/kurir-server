import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import pkg from "@/../package.json";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [settings, history] = await Promise.all([
    db.systemSettings.upsert({
      where: { id: "singleton" },
      create: {},
      update: {},
    }),
    db.updateLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({
    currentVersion: pkg.version,
    updateAvailable: settings.updateAvailable,
    latestVersion: settings.latestVersion,
    latestReleaseUrl: settings.latestReleaseUrl,
    latestChangelog: settings.latestChangelog,
    lastUpdateCheck: settings.lastUpdateCheck?.toISOString() ?? null,
    updateMode: settings.updateMode,
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
  const { updateMode } = body;

  if (updateMode && !["off", "notify", "auto"].includes(updateMode)) {
    return NextResponse.json({ error: "Invalid update mode" }, { status: 400 });
  }

  const settings = await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { updateMode },
    update: { updateMode },
  });

  return NextResponse.json({ updateMode: settings.updateMode });
}
