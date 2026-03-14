"use server";

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

  return { success: true };
}
