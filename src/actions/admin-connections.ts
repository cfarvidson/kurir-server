"use server";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { revalidatePath } from "next/cache";

export async function getConnectionsForUser(targetUserId: string) {
  await requireAdmin();

  const connections = await db.emailConnection.findMany({
    where: { userId: targetUserId },
    select: {
      id: true,
      email: true,
      displayName: true,
      imapHost: true,
      smtpHost: true,
      isDefault: true,
      createdAt: true,
      syncState: {
        select: {
          isSyncing: true,
          syncError: true,
          lastFullSync: true,
          lastSyncLog: true,
        },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return connections;
}

export async function addConnectionForUser(
  targetUserId: string,
  data: {
    email: string;
    password: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
  },
) {
  await requireAdmin();

  // Verify target user exists
  const user = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });
  if (!user) throw new Error("User not found");

  // Verify IMAP credentials
  const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
  const isValid = await verifyImapCredentials(
    data.email,
    data.password,
    data.imapHost,
    data.imapPort,
  );
  if (!isValid) {
    throw new Error(
      "Could not connect to IMAP server. Check the email and password.",
    );
  }

  // Check for duplicate
  const existing = await db.emailConnection.findFirst({
    where: { userId: targetUserId, email: data.email },
  });
  if (existing) throw new Error("This email is already connected.");

  // If first connection, make it default
  const count = await db.emailConnection.count({
    where: { userId: targetUserId },
  });
  const isDefault = count === 0;

  await db.emailConnection.create({
    data: {
      userId: targetUserId,
      email: data.email,
      encryptedPassword: encrypt(data.password),
      imapHost: data.imapHost,
      imapPort: data.imapPort,
      smtpHost: data.smtpHost,
      smtpPort: data.smtpPort,
      isDefault,
    },
  });

  revalidatePath("/settings/admin");
}

export async function deleteConnectionForUser(connectionId: string) {
  await requireAdmin();

  const connection = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true },
  });
  if (!connection) throw new Error("Connection not found");

  // Stop IDLE connection if active
  const { connectionManager } = await import("@/lib/mail/connection-manager");
  await connectionManager.stopConnection(connectionId);

  // Delete related data
  await db.$transaction([
    db.message.deleteMany({ where: { emailConnectionId: connectionId } }),
    db.folder.deleteMany({ where: { emailConnectionId: connectionId } }),
    db.sender.deleteMany({ where: { emailConnectionId: connectionId } }),
    db.syncState.deleteMany({ where: { emailConnectionId: connectionId } }),
    db.emailConnection.delete({ where: { id: connectionId } }),
  ]);

  revalidatePath("/settings/admin");
}

export async function triggerSyncForConnection(connectionId: string) {
  await requireAdmin();

  const connection = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true },
  });
  if (!connection) throw new Error("Connection not found");

  // Add a one-off sync job via BullMQ
  const { getSyncQueue } = await import("@/lib/jobs/queue");
  const queue = getSyncQueue();
  await queue.add(
    "sync",
    {
      emailConnectionId: connectionId,
      userId: connection.userId,
    },
    {
      jobId: `admin-sync-${connectionId}-${Date.now()}`,
      priority: 1, // High priority
    },
  );

  revalidatePath("/settings/admin");
}
