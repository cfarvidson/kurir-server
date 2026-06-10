import { withImapConnection, findArchiveMailbox } from "@/lib/mail/imap-client";
import { suppressEcho } from "@/lib/mail/flag-push";
import { db } from "@/lib/db";

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
  // Pre-move skip: `moveToArchiveViaImap` runs deferred (via `after()`), so by
  // the time it fires the user may already have pressed Undo, which flips
  // `isArchived` back to false in the DB. Re-query the candidate messages and
  // keep only those still archived. Undone messages must get neither an IMAP
  // move nor a 10s echo-suppression entry — a stale suppression entry would
  // swallow genuine IDLE flag/expunge events for that UID. The DB is
  // authoritative (see auto-archive-rejected-screener-messages.md).
  const stillArchived = await db.message.findMany({
    where: {
      userId,
      emailConnectionId: connectionId,
      folderId,
      uid: { in: uids },
      isArchived: true,
    },
    select: { id: true, uid: true },
  });

  if (stillArchived.length === 0) {
    // Everything was undone before the deferred move ran. Nothing to move,
    // and crucially nothing to suppress.
    return;
  }

  const archiveUids = stillArchived.map((m) => m.uid);
  // Map source UID -> message row id so we can persist the post-move location.
  const messageIdBySourceUid = new Map(
    stillArchived.map((m) => [m.uid, m.id] as const),
  );

  for (const uid of archiveUids) {
    suppressEcho(userId, folderId, uid);
  }

  const result = await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      console.log(
        `[imap] Moving ${archiveUids.length} message(s) to ${archiveBox.path}`,
      );
      // Aggregate the COPYUID source->destination map across all batches so we
      // can repoint the moved rows at the archive folder afterwards.
      const uidMap = new Map<number, number>();
      let anyUidMapMissing = false;
      const lock = await client.getMailboxLock("INBOX");
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < archiveUids.length; i += BATCH_SIZE) {
          const chunk = archiveUids.slice(i, i + BATCH_SIZE);
          try {
            const moveResult = await client.messageMove(chunk, archiveBox.path, {
              uid: true,
            });
            if (moveResult && moveResult.uidMap) {
              for (const [src, dest] of moveResult.uidMap) {
                uidMap.set(src, dest);
              }
            } else {
              anyUidMapMissing = true;
            }
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

      return { archivePath: archiveBox.path, uidMap, anyUidMapMissing };
    } else {
      console.warn(
        `[imap] No archive folder found. Available: ${mailboxes.map((mb) => `${mb.path} (${mb.specialUse || "no special use"})`).join(", ")}`,
      );
      return undefined;
    }
  });

  if (result === null) {
    console.warn(
      `[imap] moveToArchiveViaImap failed: IMAP connection returned null for ${archiveUids.length} message(s)`,
    );
    return;
  }

  if (!result) {
    // No archive folder; nothing moved, nothing to persist.
    return;
  }

  // Post-move location persistence: repoint moved rows at the destination
  // archive folder using the COPYUID map, so a later `unarchiveConversation`
  // (which computes its reverse move from `folderId`) can still issue the
  // reverse IMAP move after the deferred archive move has completed.
  await persistArchiveLocations(
    connectionId,
    result.archivePath,
    result.uidMap,
    messageIdBySourceUid,
    result.anyUidMapMissing,
  );
}

/**
 * Update moved rows' folderId/uid to the destination archive folder using the
 * COPYUID uidMap returned by `messageMove`. If the server returned no uidMap
 * (no UIDPLUS support, or a failed batch), leave the affected rows as-is and
 * log a warning — the next sync reconciles their location.
 */
async function persistArchiveLocations(
  connectionId: string,
  archivePath: string,
  uidMap: Map<number, number>,
  messageIdBySourceUid: Map<number, string>,
  anyUidMapMissing: boolean,
) {
  if (uidMap.size === 0) {
    console.warn(
      `[imap] No COPYUID uidMap returned for archive move on ${archivePath}; ` +
        `leaving message locations unchanged (next sync reconciles).`,
    );
    return;
  }

  // Resolve the destination archive folder row. The IMAP path is authoritative
  // and uniquely identifies the folder (@@unique([emailConnectionId, path])).
  const archiveFolder = await db.folder.findFirst({
    where: { emailConnectionId: connectionId, path: archivePath },
    select: { id: true },
  });

  if (!archiveFolder) {
    console.warn(
      `[imap] Archive folder row not found for ${archivePath} ` +
        `(connection ${connectionId}); leaving message locations unchanged.`,
    );
    return;
  }

  for (const [sourceUid, destUid] of uidMap) {
    const messageId = messageIdBySourceUid.get(sourceUid);
    if (!messageId) continue;
    await db.message.update({
      where: { id: messageId },
      data: { folderId: archiveFolder.id, uid: destUid },
    });
  }

  if (anyUidMapMissing) {
    console.warn(
      `[imap] Some archive batches returned no COPYUID uidMap on ${archivePath}; ` +
        `those rows left unchanged (next sync reconciles).`,
    );
  }
}

export async function moveToInboxViaImap(
  userId: string,
  connectionId: string,
  folderId: string,
  uids: number[],
) {
  // Symmetric pre-move skip: this also runs deferred, so the user may have
  // re-archived before it fires. Keep only the messages that are still
  // unarchived (i.e. still in the archive folder). Re-archived messages must
  // get neither a reverse move nor an echo-suppression entry.
  const stillUnarchived = await db.message.findMany({
    where: {
      userId,
      emailConnectionId: connectionId,
      folderId,
      uid: { in: uids },
      isArchived: false,
    },
    select: { uid: true },
  });

  if (stillUnarchived.length === 0) return;

  const inboxUids = stillUnarchived.map((m) => m.uid);

  for (const uid of inboxUids) {
    suppressEcho(userId, folderId, uid);
  }

  await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      const lock = await client.getMailboxLock(archiveBox.path);
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < inboxUids.length; i += BATCH_SIZE) {
          const chunk = inboxUids.slice(i, i + BATCH_SIZE);
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
