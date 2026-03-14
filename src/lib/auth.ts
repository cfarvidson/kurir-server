import NextAuth from "next-auth";
import { db } from "./db";
import { decrypt } from "./crypto";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [],
});

// Helper to get current user with DB data
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return db.user.findUnique({
    where: { id: session.user.id },
  });
}

// Helper to get all email connections for a user
export async function getUserEmailConnections(userId: string) {
  return db.emailConnection.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

// Helper to get a single email connection (verifies ownership)
export async function getEmailConnection(connectionId: string, userId: string) {
  return db.emailConnection.findFirst({
    where: { id: connectionId, userId },
  });
}

// Helper to get decrypted credentials for a specific email connection
export async function getConnectionCredentials(connectionId: string) {
  const conn = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: {
      email: true,
      encryptedPassword: true,
      imapHost: true,
      imapPort: true,
      smtpHost: true,
      smtpPort: true,
      sendAsEmail: true,
    },
  });

  if (!conn) return null;

  return {
    email: conn.email,
    sendAsEmail: conn.sendAsEmail,
    password: decrypt(conn.encryptedPassword),
    imap: {
      host: conn.imapHost,
      port: conn.imapPort,
    },
    smtp: {
      host: conn.smtpHost,
      port: conn.smtpPort,
    },
  };
}

// Helper to get credentials for the default connection of a user.
// Falls back to the first connection if no default is set.
export async function getDefaultConnectionCredentials(userId: string) {
  const conn = await db.emailConnection.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      encryptedPassword: true,
      imapHost: true,
      imapPort: true,
      smtpHost: true,
      smtpPort: true,
      sendAsEmail: true,
    },
  });

  if (!conn) return null;

  return {
    connectionId: conn.id,
    email: conn.email,
    sendAsEmail: conn.sendAsEmail,
    password: decrypt(conn.encryptedPassword),
    imap: {
      host: conn.imapHost,
      port: conn.imapPort,
    },
    smtp: {
      host: conn.smtpHost,
      port: conn.smtpPort,
    },
  };
}
