import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Internal endpoint called by kurir-update.sh to report update completion.
 * Authenticated via UPDATE_LOG_ID (known only to the spawned script).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { logId, status, error } = body;

  if (!logId || !status) {
    return NextResponse.json(
      { error: "Missing logId or status" },
      { status: 400 },
    );
  }

  const log = await db.updateLog.findUnique({ where: { id: logId } });
  if (!log) {
    return NextResponse.json({ error: "Unknown log ID" }, { status: 404 });
  }

  const now = new Date();
  const durationMs = now.getTime() - log.createdAt.getTime();

  await db.updateLog.update({
    where: { id: logId },
    data: {
      status,
      error: error ?? null,
      durationMs,
      completedAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}
