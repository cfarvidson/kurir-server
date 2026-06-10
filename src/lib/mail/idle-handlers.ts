import { ImapFlow } from "imapflow";
import { db } from "@/lib/db";
import { emitToUser } from "./sse-subscribers";
import { isEcho } from "./flag-push";
import { pushToUser } from "./push-sender";
import { isSyncLockHeld } from "./sync-lock";
import {
  connectionManager,
  type EmailConnectionConn,
} from "./connection-manager";

/**
 * Debounce window for rapid 'exists' arrivals (ms).
 */
const EXISTS_DEBOUNCE_MS = 200;

/**
 * Backoff schedule for deferring a new-message check while the sync lock is
 * held. One entry per retry attempt (~5s, ~15s, ~30s ≈ 50s of coverage). On
 * exhaustion the 60s sync job is the backstop, so a dropped check is bounded.
 */
const SYNC_LOCK_RETRY_BACKOFF_MS = [5_000, 15_000, 30_000];

/**
 * Shared debounce key for the 'exists' new-message check. Both the initial
 * debounce and every deferred retry schedule under this key in
 * `conn.debounceTimers`, so timers REPLACE rather than stack — at most one
 * pending check per connection, and connection teardown's existing
 * `debounceTimers` cleanup cancels it for free.
 */
const EXISTS_TIMER_KEY = "exists";

/**
 * Per-connection count of consecutive sync-lock-deferred retries. Reset to 0
 * by any fresh 'exists' event and on a completed check. Keyed by connectionId
 * (not the `conn` object, which is recreated on reconnect).
 */
const retryAttempts = new Map<string, number>();

/**
 * Per-connection in-flight guard: a check already running for a connection
 * makes a concurrent caller (a retry firing alongside a fresh debounced event)
 * coalesce — the second caller returns immediately, and the in-flight run
 * re-reads `lastUid` from the DB so nothing is missed.
 */
const inFlight = new Set<string>();

/**
 * Wrap an async handler so unhandled rejections don't crash Node.js.
 * EventEmitter does not await async listeners.
 */
function safeAsync<T>(fn: (data: T) => Promise<void>) {
  return (data: T) => {
    fn(data).catch((err) => console.error("[idle] handler error:", err));
  };
}

/**
 * Map IMAP flag set to DB boolean fields.
 */
function mapFlagsToDb(flags: Set<string>) {
  return {
    isRead: flags.has("\\Seen"),
    isFlagged: flags.has("\\Flagged"),
    isAnswered: flags.has("\\Answered"),
    isDeleted: flags.has("\\Deleted"),
    isDraft: flags.has("\\Draft"),
  };
}

/**
 * Register all IDLE event handlers on a connection's client.
 */
export function registerIdleHandlers(conn: EmailConnectionConn): void {
  const { client, connectionId, userId, folderId } = conn;

  // --- exists: new messages arrived ---
  client.on(
    "exists",
    safeAsync(async (_data: { count?: number; prevCount?: number }) => {
      connectionManager.touchActivity(connectionId);
      // A fresh arrival resets the sync-lock retry budget.
      retryAttempts.delete(connectionId);
      // Debounce rapid arrivals, then run a lock-aware new-message check.
      scheduleNewMessageCheck(connectionId, EXISTS_DEBOUNCE_MS);
    }),
  );

  // --- expunge: message permanently removed ---
  client.on(
    "expunge",
    safeAsync(async (data: { seq?: number; uid?: number }) => {
      if (!data.uid) return; // should not happen with qresync
      await handleExpunge(userId, folderId, data.uid);
    }),
  );

  // --- flags: flag change on existing message ---
  client.on(
    "flags",
    safeAsync(
      async (data: {
        seq?: number;
        uid?: number;
        flags?: Set<string>;
        modseq?: bigint;
      }) => {
        if (!data.uid || !data.flags) return;
        await handleFlagChange(
          userId,
          folderId,
          data.uid,
          data.flags,
          data.modseq,
        );
      },
    ),
  );
}

/**
 * Schedule a lock-aware new-message check for a connection after `delayMs`,
 * replacing any pending check (debounce or deferred retry) under the shared
 * `EXISTS_TIMER_KEY`. Storing the timer in `conn.debounceTimers` means at most
 * one pending check exists per connection and connection teardown cancels it.
 *
 * If the connection is no longer live (torn down / not yet reconnected) the
 * schedule is silently abandoned — a missing connection has nowhere to run.
 */
function scheduleNewMessageCheck(connectionId: string, delayMs: number): void {
  const conn = connectionManager.getConnection(connectionId);
  if (!conn) return;

  const existing = conn.debounceTimers.get(EXISTS_TIMER_KEY);
  if (existing) clearTimeout(existing);

  conn.debounceTimers.set(
    EXISTS_TIMER_KEY,
    setTimeout(() => {
      // Re-resolve the live connection at fire time; clear our own timer entry.
      const liveConn = connectionManager.getConnection(connectionId);
      liveConn?.debounceTimers.delete(EXISTS_TIMER_KEY);
      handleNewMessages(connectionId).catch((err) =>
        console.error("[idle] handleNewMessages error:", err),
      );
    }, delayMs),
  );
}

/**
 * Run one lock-aware new-message UID-delta check for a connection.
 *
 * This is the single ingestion path the IDLE 'exists' handler uses; it is also
 * the entry point for boot-time / post-reconnect catch-up (U5). The connection
 * and live client are re-resolved from the connection manager at call time, so
 * callers must not close over a possibly-reconnected client.
 *
 * Behavior:
 * - If the connection is gone, returns silently (nothing to fetch).
 * - If the sync lock is held (stale-aware via `isSyncLockHeld`), the check is
 *   deferred via {@link scheduleNewMessageCheck} with bounded backoff rather
 *   than dropped; on attempt exhaustion it logs once and gives up (the 60s
 *   sync job is the backstop).
 * - A per-connection in-flight guard coalesces a retry that fires alongside a
 *   fresh debounced event into a single execution.
 */
export async function checkForNewMessages(connectionId: string): Promise<void> {
  return handleNewMessages(connectionId);
}

/**
 * Handle new messages from an IDLE 'exists' event (or a catch-up trigger).
 * Re-resolves the live connection/client, honors the sync lock with deferral,
 * then fetches and ingests only UIDs above the highest we already store.
 */
async function handleNewMessages(connectionId: string): Promise<void> {
  // In-flight guard: coalesce concurrent triggers into one run. The running
  // execution re-reads lastUid from the DB, so the dropped caller misses nothing.
  if (inFlight.has(connectionId)) return;

  const conn = connectionManager.getConnection(connectionId);
  if (!conn) return; // connection torn down — nothing to do
  const { client, userId, folderId } = conn;

  // Defer (never drop) while a full sync holds the lock. Stale-aware: a crashed
  // lock older than STALE_LOCK_MS reads as not held and we proceed immediately.
  if (await isSyncLockHeld(connectionId)) {
    const attempt = retryAttempts.get(connectionId) ?? 0;
    if (attempt >= SYNC_LOCK_RETRY_BACKOFF_MS.length) {
      console.log(
        `[idle] Sync lock held; new-message check deferred ${attempt} time(s) for connection ${connectionId}, giving up (next sync job is the backstop)`,
      );
      retryAttempts.delete(connectionId);
      return;
    }
    retryAttempts.set(connectionId, attempt + 1);
    scheduleNewMessageCheck(connectionId, SYNC_LOCK_RETRY_BACKOFF_MS[attempt]);
    return;
  }

  // Lock free — this check will complete; clear the deferral budget.
  retryAttempts.delete(connectionId);

  inFlight.add(connectionId);
  try {
    await ingestNewMessages(connectionId, userId, folderId, client);
  } finally {
    inFlight.delete(connectionId);
  }
}

/**
 * Fetch UIDs above our stored max for the folder, process them (deduping per
 * UID and tolerating a P2002 race with a concurrent sync), and emit SSE / push
 * for genuinely new messages only.
 */
async function ingestNewMessages(
  connectionId: string,
  userId: string,
  folderId: string,
  client: ImapFlow,
): Promise<void> {
  // Find highest UID we already have for this folder
  const lastMsg = await db.message.findFirst({
    where: { folderId, uid: { gt: 0 } },
    orderBy: { uid: "desc" },
    select: { uid: true },
  });
  const lastUid = lastMsg?.uid ?? 0;

  // Fetch new messages (uid > lastUid)
  const fetchRange = `${lastUid + 1}:*`;
  let count = 0;
  const newImboxMessages: Array<{
    fromName: string | null;
    fromAddress: string;
    subject: string | null;
    threadId: string | null;
    id: string;
  }> = [];

  // Look up the email for this connection (for auto-approve logic)
  const emailConn = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: { email: true, sendAsEmail: true, aliases: true },
  });

  try {
    for await (const msg of client.fetch(
      fetchRange,
      {
        envelope: true,
        internalDate: true,
        flags: true,
        bodyStructure: true,
        source: true,
      },
      { uid: true },
    )) {
      if (msg.uid <= lastUid) continue; // range may include lastUid

      // Check if we already have this message (sync may have ingested it).
      const exists = await db.message.findFirst({
        where: { folderId, uid: msg.uid },
        select: { id: true },
      });
      if (exists) continue;

      const { processMessage } = await import("./sync-service");
      const userEmails = [
        emailConn?.email,
        emailConn?.sendAsEmail,
        ...(emailConn?.aliases ?? []),
      ].filter(Boolean) as string[];

      let message;
      try {
        message = await processMessage(msg, userId, connectionId, folderId, {
          isInbox: true,
          userEmails,
        });
      } catch (err) {
        // A concurrent sync can insert the same [folderId, uid] between our
        // existence check and this write (P2002). That row is already present,
        // so skip it without aborting the loop or treating it as a failure.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      count++;

      // Collect Imbox messages for push notifications
      if (message?.isInImbox) {
        newImboxMessages.push(message);
      }
    }
  } catch (err) {
    console.error("[idle] fetch new messages error:", err);
  }

  if (count > 0) {
    console.log(
      `[idle] ${count} new message(s) for connection ${connectionId}`,
    );
    emitToUser(userId, { type: "new-messages", data: { folderId, count } });
  }

  // Send push notifications for new Imbox messages (fire-and-forget)
  if (newImboxMessages.length > 0) {
    // Dedupe by threadId — only latest message per thread
    const byThread = new Map<string, (typeof newImboxMessages)[0]>();
    for (const m of newImboxMessages) {
      byThread.set(m.threadId || m.id, m);
    }

    for (const m of byThread.values()) {
      pushToUser(userId, {
        title: m.fromName || m.fromAddress,
        body: m.subject || "(no subject)",
        url: `/imbox/${m.id}`,
        tag: m.threadId || m.id,
      }).catch((err) => console.error("[push] error:", err));
    }
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Handle expunge event — mark message as deleted.
 */
async function handleExpunge(
  userId: string,
  folderId: string,
  uid: number,
): Promise<void> {
  if (isEcho(userId, folderId, uid)) return;

  const message = await db.message.findFirst({
    where: { folderId, uid },
    select: { id: true, isArchived: true },
  });
  if (!message) return;

  // Don't mark archived messages as deleted (they were IMAP-moved, not deleted)
  if (message.isArchived) return;

  await db.message.update({
    where: { id: message.id },
    data: { isDeleted: true },
  });

  console.log(`[idle] Message expunged: uid=${uid} folder=${folderId}`);
  emitToUser(userId, {
    type: "message-deleted",
    data: { messageId: message.id },
  });
}

/**
 * Handle flag change event — update DB, emit SSE.
 */
async function handleFlagChange(
  userId: string,
  folderId: string,
  uid: number,
  flags: Set<string>,
  modseq?: bigint,
): Promise<void> {
  if (isEcho(userId, folderId, uid)) return;

  const message = await db.message.findFirst({
    where: { folderId, uid },
    select: {
      id: true,
      isRead: true,
      isFlagged: true,
      isAnswered: true,
      isDeleted: true,
      isDraft: true,
    },
  });
  if (!message) return;

  const newFlags = mapFlagsToDb(flags);

  // Only update if something changed
  const changed =
    message.isRead !== newFlags.isRead ||
    message.isFlagged !== newFlags.isFlagged ||
    message.isAnswered !== newFlags.isAnswered ||
    message.isDeleted !== newFlags.isDeleted ||
    message.isDraft !== newFlags.isDraft;

  if (!changed) return;

  await db.message.update({
    where: { id: message.id },
    data: newFlags,
  });

  // Update highestModSeq if modseq is present and higher
  if (modseq) {
    const folder = await db.folder.findUnique({
      where: { id: folderId },
      select: { highestModSeq: true },
    });
    if (!folder?.highestModSeq || modseq > folder.highestModSeq) {
      await db.folder.update({
        where: { id: folderId },
        data: { highestModSeq: modseq },
      });
    }
  }

  console.log(`[idle] Flags changed: uid=${uid} flags=${[...flags].join(",")}`);
  emitToUser(userId, {
    type: "flags-changed",
    data: { messageId: message.id, flags: newFlags },
  });
}

/**
 * CONDSTORE catch-up after reconnect.
 * Fetches only messages changed since last known modseq.
 */
export async function catchUpAfterReconnect(
  client: ImapFlow,
  connectionId: string,
  folderId: string,
): Promise<void> {
  const folder = await db.folder.findUnique({
    where: { id: folderId },
    select: { highestModSeq: true },
  });
  if (!folder?.highestModSeq) return;

  // Look up userId for SSE emission
  const emailConn = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: { userId: true },
  });
  if (!emailConn) return;

  let maxModSeq = folder.highestModSeq;
  let changeCount = 0;

  try {
    for await (const msg of client.fetch(
      "1:*",
      { flags: true },
      { uid: true, changedSince: folder.highestModSeq },
    )) {
      if (!msg.uid || !msg.flags) continue;

      const dbMsg = await db.message.findFirst({
        where: { folderId, uid: msg.uid },
        select: {
          id: true,
          isRead: true,
          isFlagged: true,
          isAnswered: true,
          isDeleted: true,
          isDraft: true,
        },
      });
      if (!dbMsg) continue;

      const newFlags = mapFlagsToDb(msg.flags);
      const changed =
        dbMsg.isRead !== newFlags.isRead ||
        dbMsg.isFlagged !== newFlags.isFlagged ||
        dbMsg.isAnswered !== newFlags.isAnswered ||
        dbMsg.isDeleted !== newFlags.isDeleted ||
        dbMsg.isDraft !== newFlags.isDraft;

      if (changed) {
        await db.message.update({
          where: { id: dbMsg.id },
          data: newFlags,
        });
        changeCount++;
        emitToUser(emailConn.userId, {
          type: "flags-changed",
          data: { messageId: dbMsg.id, flags: newFlags },
        });
      }

      if (msg.modseq && msg.modseq > maxModSeq) {
        maxModSeq = msg.modseq;
      }
    }
  } catch (err) {
    console.error("[idle] CONDSTORE catch-up error:", err);
    return;
  }

  if (maxModSeq > folder.highestModSeq) {
    await db.folder.update({
      where: { id: folderId },
      data: { highestModSeq: maxModSeq },
    });
  }

  if (changeCount > 0) {
    console.log(
      `[idle] Catch-up: ${changeCount} flag changes for connection ${connectionId}`,
    );
  }
}
