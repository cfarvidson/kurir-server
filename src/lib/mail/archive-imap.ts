import { withImapConnection, findArchiveMailbox } from "@/lib/mail/imap-client";
import { suppressEcho } from "@/lib/mail/flag-push";

// Internal IMAP move helpers. These live in a plain lib module — NOT a
// "use server" action file — on purpose: every export of a "use server"
// module is registered as a directly-callable RPC endpoint. These functions
// take a connectionId and move real mail on the user's IMAP server with no
// auth/ownership check of their own, so exposing them as actions would let any
// authenticated user move another tenant's mail. Callers (archive/senders
// actions) authenticate the session and verify ownership before invoking.

export async function moveToArchiveViaImap(
  userId: string,
  connectionId: string,
  folderId: string,
  uids: number[],
) {
  for (const uid of uids) {
    suppressEcho(userId, folderId, uid);
  }

  const result = await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      console.log(
        `[imap] Moving ${uids.length} message(s) to ${archiveBox.path}`,
      );
      const lock = await client.getMailboxLock("INBOX");
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
          const chunk = uids.slice(i, i + BATCH_SIZE);
          try {
            await client.messageMove(chunk, archiveBox.path, {
              uid: true,
            });
          } catch (err) {
            console.error(
              `[imap] Failed to move UIDs ${chunk.join(",")}:`,
              err,
            );
          }
        }
      } finally {
        lock.release();
      }
    } else {
      console.warn(
        `[imap] No archive folder found. Available: ${mailboxes.map((mb) => `${mb.path} (${mb.specialUse || "no special use"})`).join(", ")}`,
      );
    }
  });

  if (result === null) {
    console.warn(
      `[imap] moveToArchiveViaImap failed: IMAP connection returned null for ${uids.length} message(s)`,
    );
  }
}

export async function moveToInboxViaImap(
  userId: string,
  connectionId: string,
  folderId: string,
  uids: number[],
) {
  for (const uid of uids) {
    suppressEcho(userId, folderId, uid);
  }

  await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      const lock = await client.getMailboxLock(archiveBox.path);
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
          const chunk = uids.slice(i, i + BATCH_SIZE);
          try {
            await client.messageMove(chunk, "INBOX", { uid: true });
          } catch {
            // Batch may partially fail; messages may already be moved
          }
        }
      } finally {
        lock.release();
      }
    }
  });
}
