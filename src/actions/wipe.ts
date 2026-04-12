"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { connectionManager } from "@/lib/mail/connection-manager";

/**
 * Wipe all mail data and connections for the current user.
 * Deleting EmailConnection cascades to folders, senders, messages,
 * attachments, and sync states.
 */
export async function wipeAllData() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Stop any active IMAP IDLE connections
  await connectionManager.stopAllForUser(userId);

  // Delete all email connections (cascades to everything)
  await db.emailConnection.deleteMany({ where: { userId } });

  updateTag("sidebar-counts");
  revalidatePath("/", "layout");

  return { success: true };
}

/**
 * Wipe all mail data but keep email connections.
 * Deletes messages, folders, senders, and resets sync state.
 * Connections (accounts) are preserved.
 */
export async function wipeMailData() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Stop any active IMAP IDLE connections
  await connectionManager.stopAllForUser(userId);

  const connectionIds = (
    await db.emailConnection.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((c) => c.id);

  // Delete messages, folders, senders and reset sync states per connection
  await db.$transaction([
    db.message.deleteMany({ where: { userId } }),
    db.folder.deleteMany({ where: { userId } }),
    db.sender.deleteMany({ where: { userId } }),
    ...connectionIds.map((id) =>
      db.syncState.updateMany({
        where: { emailConnectionId: id },
        data: { lastFullSync: null, syncError: null, isSyncing: false },
      }),
    ),
  ]);

  updateTag("sidebar-counts");
  revalidatePath("/", "layout");

  return { success: true };
}
