import { db } from "@/lib/db";
import { withImapConnection } from "./imap-client";

// Inline echo suppression — plain Set + setTimeout
const pendingEchoes = new Set<string>();

export function suppressEcho(
  userId: string,
  folderId: string,
  uid: number,
): void {
  const key = `${userId}:${folderId}:${uid}`;
  pendingEchoes.add(key);
  setTimeout(() => pendingEchoes.delete(key), 10_000);
}

export function isEcho(userId: string, folderId: string, uid: number): boolean {
  const key = `${userId}:${folderId}:${uid}`;
  return pendingEchoes.delete(key); // returns true if was present
}

/**
 * Push flag changes to IMAP server.
 * Resolves the emailConnectionId from the message's folder.
 * Always opens a short-lived connection: the persistent IDLE client holds its
 * INBOX mailbox lock for the connection's lifetime and ImapFlow grants one lock
 * at a time, so a lock requested on that client queues forever and the flag
 * never reaches IMAP.
 */
export async function pushFlagsToImap(
  userId: string,
  messages: Array<{ uid: number; folderId: string }>,
  flag: string,
  action: "add" | "remove",
): Promise<void> {
  const imapMessages = messages.filter((m) => m.uid > 0);
  if (imapMessages.length === 0) return;

  // Register echo suppression before push
  for (const msg of imapMessages) {
    suppressEcho(userId, msg.folderId, msg.uid);
  }

  // Resolve connectionId from the first message's folder
  const folder = await db.folder.findUnique({
    where: { id: imapMessages[0].folderId },
    select: { emailConnectionId: true },
  });
  if (!folder?.emailConnectionId) return;

  await withImapConnection(folder.emailConnectionId, async (client) => {
    await pushWithClient(client, imapMessages, flag, action);
  });
}

async function pushWithClient(
  client: import("imapflow").ImapFlow,
  messages: Array<{ uid: number; folderId: string }>,
  flag: string,
  action: "add" | "remove",
): Promise<void> {
  // Group by folderId to minimize mailbox lock switches
  const byFolder = new Map<string, number[]>();
  for (const msg of messages) {
    const uids = byFolder.get(msg.folderId) ?? [];
    uids.push(msg.uid);
    byFolder.set(msg.folderId, uids);
  }

  for (const [folderId, uids] of byFolder) {
    const folder = await db.folder.findUnique({
      where: { id: folderId },
      select: { path: true },
    });
    if (!folder) continue;

    const lock = await client.getMailboxLock(folder.path);
    try {
      for (const uid of uids) {
        try {
          if (action === "add") {
            await client.messageFlagsAdd(String(uid), [flag], { uid: true });
          } else {
            await client.messageFlagsRemove(String(uid), [flag], { uid: true });
          }
        } catch (err) {
          console.error(`[flag-push] Failed uid=${uid} flag=${flag}:`, err);
        }
      }
    } finally {
      lock.release();
    }
  }
}
