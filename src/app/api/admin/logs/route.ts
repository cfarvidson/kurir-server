import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Query sync states with logs or errors
  const syncStates = await db.syncState.findMany({
    where: {
      OR: [{ lastSyncLog: { not: null } }, { syncError: { not: null } }],
    },
    include: {
      emailConnection: {
        select: { email: true },
      },
    },
    orderBy: { lastFullSync: "desc" },
    take: 100,
  });

  // Also get recent failed scheduled messages
  const failedMessages = await db.scheduledMessage.findMany({
    where: { status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      to: true,
      subject: true,
      error: true,
      updatedAt: true,
    },
  });

  // Format as log entries
  const logs: {
    type: "sync" | "error";
    email: string;
    timestamp: string | null;
    message: string;
  }[] = [];

  for (const s of syncStates) {
    if (s.lastSyncLog) {
      logs.push({
        type: "sync" as const,
        email: s.emailConnection.email,
        timestamp: s.lastFullSync?.toISOString() ?? null,
        message: s.lastSyncLog,
      });
    }
    if (s.syncError) {
      logs.push({
        type: "error" as const,
        email: s.emailConnection.email,
        timestamp: s.syncStartedAt?.toISOString() ?? null,
        message: s.syncError,
      });
    }
  }

  for (const m of failedMessages) {
    logs.push({
      type: "error" as const,
      email: m.to,
      timestamp: m.updatedAt.toISOString(),
      message: `Scheduled message failed: "${m.subject}" — ${m.error ?? "Unknown error"}`,
    });
  }

  // Sort by timestamp desc
  logs.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  return NextResponse.json({ logs });
}
