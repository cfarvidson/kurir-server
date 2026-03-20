import { db } from "@/lib/db";
import { syncEmailConnection, type SyncResult } from "./sync-service";
import { pushToUser } from "./push-sender";
import { connectionManager } from "./connection-manager";
import { sendDueScheduledMessages } from "./scheduled-send";

const SYNC_INTERVAL_MS = 60_000; // 1 minute
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

let started = false;

async function claimSyncLock(emailConnectionId: string): Promise<boolean> {
  await db.syncState.upsert({
    where: { emailConnectionId },
    create: { emailConnectionId },
    update: {},
  });

  const claimed = await db.syncState.updateMany({
    where: {
      emailConnectionId,
      OR: [
        { isSyncing: false },
        { syncStartedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      ],
    },
    data: { isSyncing: true, syncStartedAt: new Date(), syncError: null },
  });

  return claimed.count > 0;
}

async function releaseSyncLock(
  emailConnectionId: string,
  error?: string,
  log?: string,
) {
  await db.syncState.updateMany({
    where: { emailConnectionId },
    data: {
      isSyncing: false,
      syncError: error || null,
      lastSyncLog: log || null,
      ...(!error ? { lastFullSync: new Date() } : {}),
    },
  });
}

function buildSyncLog(results: SyncResult[]): string {
  return results
    .map((r) => {
      let line = `${r.folderPath}: ${r.totalOnServer} on server, ${r.totalCached} cached, ${r.newMessages} new`;
      if (r.remaining > 0) line += `, ${r.remaining} remaining`;
      if (r.errors.length > 0) line += `, ${r.errors.length} errors`;
      return line;
    })
    .join("\n");
}

export async function checkExpiredFollowUps(userId: string): Promise<number> {
  // Get all user emails to exclude their own replies from the "reply arrived" check
  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { email: true, sendAsEmail: true, aliases: true },
  });
  const userEmails = [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];

  // Fire follow-ups where deadline passed and no incoming reply arrived since the reminder was set
  const result: { count: number }[] = await db.$queryRawUnsafe(
    `
    WITH expired AS (
      SELECT DISTINCT "threadId", "followUpSetAt"
      FROM "Message"
      WHERE "userId" = $1
        AND "followUpAt" <= NOW()
        AND "isFollowUp" = false
        AND "followUpAt" IS NOT NULL
        AND "threadId" IS NOT NULL
    ),
    no_reply AS (
      SELECT e."threadId"
      FROM expired e
      WHERE NOT EXISTS (
        SELECT 1 FROM "Message" m2
        WHERE m2."threadId" = e."threadId"
          AND m2."userId" = $1
          AND m2."receivedAt" > e."followUpSetAt"
          AND LOWER(m2."fromAddress") != ALL($2::text[])
      )
    )
    UPDATE "Message" SET "isFollowUp" = true
    WHERE "userId" = $1
      AND "threadId" IN (SELECT "threadId" FROM no_reply)
      AND "followUpAt" IS NOT NULL
    `,
    userId,
    userEmails,
  );

  return result.length > 0 && "count" in result[0] ? result[0].count : 0;
}

async function wakeExpiredSnoozes(userId: string): Promise<number> {
  const result = await db.message.updateMany({
    where: {
      userId,
      isSnoozed: true,
      snoozedUntil: { lte: new Date() },
    },
    data: {
      isSnoozed: false,
      snoozedUntil: null,
      isRead: false,
    },
  });
  return result.count;
}

async function syncAndNotify() {
  try {
    // Send any due scheduled messages before IMAP sync
    try {
      await sendDueScheduledMessages();
    } catch (err) {
      console.error("[bg-sync] scheduled-send error:", err);
    }

    // Get all users with email connections
    const users = await db.user.findMany({
      select: {
        id: true,
        emailConnections: { select: { id: true } },
      },
    });

    for (const user of users) {
      // Start IDLE connections (no-op if already connected)
      connectionManager.startAllForUser(user.id).catch(console.error);

      // Wake expired snoozes
      await wakeExpiredSnoozes(user.id).catch(console.error);

      // Fire expired follow-up reminders
      await checkExpiredFollowUps(user.id).catch(console.error);

      // Sync each email connection
      let totalNew = 0;

      for (const conn of user.emailConnections) {
        const locked = await claimSyncLock(conn.id);
        if (!locked) continue;

        try {
          const result = await syncEmailConnection(conn.id);
          const log = buildSyncLog(result.results);
          await releaseSyncLock(
            conn.id,
            result.success ? undefined : result.error,
            log,
          );

          // Only count INBOX new messages for push (not Sent/Archive)
          totalNew += result.results
            .filter((r) => r.folderPath === "INBOX")
            .reduce((sum, r) => sum + r.newMessages, 0);
        } catch (err) {
          await releaseSyncLock(conn.id, String(err));
        }
      }

      // Send push notifications for new Imbox messages
      if (totalNew > 0) {
        const recentImbox = await db.message.findMany({
          where: {
            userId: user.id,
            isInImbox: true,
            createdAt: { gte: new Date(Date.now() - 120_000) },
          },
          select: {
            id: true,
            fromName: true,
            fromAddress: true,
            subject: true,
            threadId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        });

        if (recentImbox.length > 0) {
          const byThread = new Map<string, (typeof recentImbox)[0]>();
          for (const m of recentImbox) {
            const key = m.threadId || m.id;
            if (!byThread.has(key)) byThread.set(key, m);
          }

          for (const m of byThread.values()) {
            pushToUser(user.id, {
              title: m.fromName || m.fromAddress,
              body: m.subject || "(no subject)",
              url: `/imbox/${m.id}`,
              tag: m.threadId || m.id,
            }).catch((err) => console.error("[bg-sync] push error:", err));
          }
        }
      }
    }
  } catch (err) {
    console.error("[bg-sync] error:", err);
  }
}

export function startBackgroundSync() {
  if (started) return;
  started = true;

  console.log("[bg-sync] Starting background sync worker (60s interval)");

  // First sync after 5 seconds (let the server fully start)
  setTimeout(() => {
    syncAndNotify();
    // Then run every 60 seconds
    setInterval(syncAndNotify, SYNC_INTERVAL_MS);
  }, 5_000);
}
