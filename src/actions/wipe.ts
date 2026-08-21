"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth, canManageConnections } from "@/lib/auth";
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

  if (!(await canManageConnections(userId))) {
    throw new Error("Account management is disabled. Contact your admin.");
  }

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
 *
 * Do not delete CalendarAccount here. Mail-only wipe must keep calendars;
 * calendar rows cascade from User onDelete. A "cleanup" that adds
 * calendarAccount.deleteMany would break demo and real users who clear
 * mail but still want their calendars.
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

  // Mail tables only - intentionally omits CalendarAccount / Calendar /
  // CalendarEvent (see comment on wipeMailData).
  await db.$transaction([
    db.message.deleteMany({ where: { userId } }),
    db.folder.deleteMany({ where: { userId } }),
    db.sender.deleteMany({ where: { userId } }),
    db.draft.deleteMany({ where: { userId } }),
    db.scheduledMessage.deleteMany({ where: { userId } }),
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
