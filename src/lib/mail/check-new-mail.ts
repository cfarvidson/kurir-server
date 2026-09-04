import { revalidateTag } from "next/cache";
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

  let ingested = 0;
  for (const c of connections) {
    const alreadyUp = connectionManager.isConnected(c.id);
    await connectionManager.startConnection(c.id);
    // A cold start already ran catchUpNewMessages. Checking again would
    // be a second lastUid IMAP pass. An already-up connection still needs
    // the explicit check (OTP waiting on IMAP right now).
    if (alreadyUp || !connectionManager.isConnected(c.id)) {
      ingested += await checkForNewMessages(c.id);
    }
  }
  if (ingested > 0) {
    revalidateTag("sidebar-counts", { expire: 0 });
  }
  return { status: "ok", ingested };
}
