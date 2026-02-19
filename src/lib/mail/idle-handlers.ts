import { ImapFlow } from "imapflow";
import { db } from "@/lib/db";
import { emitToUser } from "./sse-subscribers";
import { isEcho } from "./flag-push";
import type { UserConnection } from "./connection-manager";

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
export function registerIdleHandlers(conn: UserConnection): void {
  const { client, userId, folderId } = conn;

  // --- exists: new messages arrived ---
  client.on(
    "exists",
    safeAsync(async (data: { count?: number; prevCount?: number }) => {
      // Debounce rapid arrivals (200ms)
      const key = "exists";
      const existing = conn.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      conn.debounceTimers.set(
        key,
        setTimeout(() => {
          conn.debounceTimers.delete(key);
          handleNewMessages(userId, folderId, client).catch((err) =>
            console.error("[idle] handleNewMessages error:", err)
          );
        }, 200)
      );
    })
  );

  // --- expunge: message permanently removed ---
  client.on(
    "expunge",
    safeAsync(async (data: { seq?: number; uid?: number }) => {
      if (!data.uid) return; // should not happen with qresync
      await handleExpunge(userId, folderId, data.uid);
    })
  );

  // --- flags: flag change on existing message ---
  client.on(
    "flags",
    safeAsync(
      async (data: { seq?: number; uid?: number; flags?: Set<string>; modseq?: bigint }) => {
        if (!data.uid || !data.flags) return;
        await handleFlagChange(userId, folderId, data.uid, data.flags, data.modseq);
      }
    )
  );
}

/**
 * Handle new messages from IDLE 'exists' event.
 * Checks sync lock, then fetches only new UIDs.
 */
async function handleNewMessages(
  userId: string,
  folderId: string,
  client: ImapFlow
): Promise<void> {
  // Skip if full sync is running
  const syncState = await db.syncState.findUnique({ where: { userId } });
  if (syncState?.isSyncing) return;

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

  try {
    for await (const msg of client.fetch(fetchRange, {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
      bodyStructure: true,
      source: true,
    })) {
      if (msg.uid <= lastUid) continue; // range may include lastUid

      // Check if we already have this message
      const exists = await db.message.findFirst({
        where: { folderId, uid: msg.uid },
        select: { id: true },
      });
      if (exists) continue;

      // Use the sync service's processMessage via dynamic import
      const { processMessage } = await import("./sync-service");
      await processMessage(msg, userId, folderId, true);
      count++;
    }
  } catch (err) {
    console.error("[idle] fetch new messages error:", err);
  }

  if (count > 0) {
    console.log(`[idle] ${count} new message(s) for user ${userId}`);
    emitToUser(userId, { type: "new-messages", data: { folderId, count } });
  }
}

/**
 * Handle expunge event — mark message as deleted.
 */
async function handleExpunge(
  userId: string,
  folderId: string,
  uid: number
): Promise<void> {
  if (isEcho(userId, folderId, uid)) return;

  const message = await db.message.findFirst({
    where: { folderId, uid },
    select: { id: true },
  });
  if (!message) return;

  await db.message.update({
    where: { id: message.id },
    data: { isDeleted: true },
  });

  console.log(`[idle] Message expunged: uid=${uid} folder=${folderId}`);
  emitToUser(userId, { type: "message-deleted", data: { messageId: message.id } });
}

/**
 * Handle flag change event — update DB, emit SSE.
 */
async function handleFlagChange(
  userId: string,
  folderId: string,
  uid: number,
  flags: Set<string>,
  modseq?: bigint
): Promise<void> {
  if (isEcho(userId, folderId, uid)) return;

  const message = await db.message.findFirst({
    where: { folderId, uid },
    select: { id: true, isRead: true, isFlagged: true, isAnswered: true, isDeleted: true, isDraft: true },
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
  userId: string,
  folderId: string
): Promise<void> {
  const folder = await db.folder.findUnique({
    where: { id: folderId },
    select: { highestModSeq: true },
  });
  if (!folder?.highestModSeq) return;

  let maxModSeq = folder.highestModSeq;
  let changeCount = 0;

  try {
    for await (const msg of client.fetch(
      "1:*",
      { uid: true, flags: true },
      { changedSince: folder.highestModSeq }
    )) {
      if (!msg.uid || !msg.flags) continue;

      const dbMsg = await db.message.findFirst({
        where: { folderId, uid: msg.uid },
        select: { id: true, isRead: true, isFlagged: true, isAnswered: true, isDeleted: true, isDraft: true },
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
        emitToUser(userId, {
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
    console.log(`[idle] Catch-up: ${changeCount} flag changes for user ${userId}`);
  }
}
