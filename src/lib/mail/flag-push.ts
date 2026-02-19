import { db } from "@/lib/db";
import { connectionManager } from "./connection-manager";
import { withImapConnection } from "./imap-client";

// Inline echo suppression — plain Set + setTimeout
const pendingEchoes = new Set<string>();

export function suppressEcho(userId: string, folderId: string, uid: number): void {
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
 * Prefers the persistent ConnectionManager client; falls back to ephemeral.
 */
export async function pushFlagsToImap(
  userId: string,
  messages: Array<{ uid: number; folderId: string }>,
  flag: string,
  action: "add" | "remove"
): Promise<void> {
  const imapMessages = messages.filter((m) => m.uid > 0);
  if (imapMessages.length === 0) return;

  // Register echo suppression before push
  for (const msg of imapMessages) {
    suppressEcho(userId, msg.folderId, msg.uid);
  }

  const persistentClient = connectionManager.getClient(userId);

  if (persistentClient) {
    await pushWithClient(persistentClient, imapMessages, flag, action);
  } else {
    await withImapConnection(userId, async (client) => {
      await pushWithClient(client, imapMessages, flag, action);
    });
  }
}

async function pushWithClient(
  client: import("imapflow").ImapFlow,
  messages: Array<{ uid: number; folderId: string }>,
  flag: string,
  action: "add" | "remove"
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
