import NextAuth from "next-auth";
import { db } from "./db";
import { decrypt } from "./crypto";
import { authConfig } from "./auth.config";
import type { OAuthProviderType } from "./oauth-providers";
import type { ConnectionCredentials } from "./mail/auth-helpers";

export type { ConnectionCredentials } from "./mail/auth-helpers";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [],
});

/** Returns authenticated session or throws Unauthorized. */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session;
}

/** Returns authenticated admin session or throws Forbidden. Verifies role from DB. */
export async function requireAdmin() {
  const session = await requireAuth();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== "ADMIN") throw new Error("Forbidden");
  return session;
}

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

// Get decrypted credentials — internal use only (no ownership check).
export async function getConnectionCredentialsInternal(connectionId: string) {
  return getConnectionCredentialsQuery(connectionId);
}

// Get decrypted credentials with ownership verification.
export async function getConnectionCredentials(
  connectionId: string,
  userId: string,
) {
  return getConnectionCredentialsQuery(connectionId, userId);
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// Deduplication lock: prevents concurrent token refreshes for the same connection
const refreshLocks = new Map<string, Promise<string>>();

async function getConnectionCredentialsQuery(
  connectionId: string,
  userId?: string,
): Promise<ConnectionCredentials | null> {
  const conn = await db.emailConnection.findFirst({
    where: { id: connectionId, ...(userId ? { userId } : {}) },
    select: {
      email: true,
      encryptedPassword: true,
      imapHost: true,
      imapPort: true,
      smtpHost: true,
      smtpPort: true,
      sendAsEmail: true,
      aliases: true,
      oauthProvider: true,
      oauthAccessToken: true,
      oauthRefreshToken: true,
      oauthTokenExpiresAt: true,
    },
  });

  if (!conn) return null;

  const base = {
    email: conn.email,
    sendAsEmail: conn.sendAsEmail,
    aliases: conn.aliases,
    imap: { host: conn.imapHost, port: conn.imapPort },
    smtp: { host: conn.smtpHost, port: conn.smtpPort },
  };

  // Password-based connection
  if (!conn.oauthProvider) {
    return {
      ...base,
      password: conn.encryptedPassword ? decrypt(conn.encryptedPassword) : null,
      accessToken: null,
      oauthProvider: null,
    };
  }

  // OAuth connection — check if token needs refresh
  const provider = conn.oauthProvider as OAuthProviderType;
  const isStale =
    !conn.oauthTokenExpiresAt ||
    !conn.oauthAccessToken ||
    conn.oauthTokenExpiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

  let accessToken: string;

  if (isStale) {
    if (!conn.oauthRefreshToken) {
      throw new Error("No refresh token available for OAuth connection");
    }
    // Deduplicate concurrent refresh calls for the same connection
    if (!refreshLocks.has(connectionId)) {
      const { refreshAndPersistToken } = await import("./oauth-providers");
      const p = refreshAndPersistToken(
        connectionId,
        provider,
        conn.oauthRefreshToken,
      ).finally(() => refreshLocks.delete(connectionId));
      refreshLocks.set(connectionId, p);
    }
    accessToken = await refreshLocks.get(connectionId)!;
  } else {
    accessToken = decrypt(conn.oauthAccessToken!);
  }

  return {
    ...base,
    password: null,
    accessToken,
    oauthProvider: provider,
  };
}

// Helper to get credentials for the default connection of a user.
// Falls back to the first connection if no default is set.
export async function getDefaultConnectionCredentials(userId: string) {
  const conn = await db.emailConnection.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!conn) return null;

  const credentials = await getConnectionCredentialsQuery(conn.id);
  if (!credentials) return null;

  return { connectionId: conn.id, ...credentials };
}
