import { db } from "@/lib/db";
import { connectionManager } from "@/lib/mail/connection-manager";
import { checkForNewMessages } from "@/lib/mail/idle-handlers";
import { rateLimitCheck } from "@/lib/rate-limit";

export type CheckNewMailResult =
  | { status: "ok"; ingested: number }
  | { status: "rate_limited"; retryAfter: number };

const inflight = new Map<string, Promise<CheckNewMailResult>>();

/**
 * Cheap on-demand IMAP new-mail check for every connection of `userId`.
 *
 * Reuses the IDLE lastUid ingest. Starts the IDLE connection if it is down
 * so a mobile-only user still gets the catch-up. Overlapping calls for the
 * same user join the in-flight check. A completed check is rate-limited to
 * once per 5 seconds; joiners of an in-flight check skip the limiter.
 */
export async function checkNewMailForUser(
  userId: string,
): Promise<CheckNewMailResult> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  const pending = runCheck(userId).finally(() => {
    if (inflight.get(userId) === pending) inflight.delete(userId);
  });
  inflight.set(userId, pending);
  return pending;
}

async function runCheck(userId: string): Promise<CheckNewMailResult> {
  const rl = await rateLimitCheck(userId);
  if (!rl.allowed) {
    return { status: "rate_limited", retryAfter: rl.retryAfter };
  }

  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { id: true },
  });

  await Promise.allSettled(
    connections.map((c) => connectionManager.startConnection(c.id)),
  );

  let ingested = 0;
  for (const c of connections) {
    ingested += await checkForNewMessages(c.id);
  }
  return { status: "ok", ingested };
}
