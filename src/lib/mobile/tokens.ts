import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * Bearer-token auth for native mobile clients.
 *
 * Both tokens are opaque random values stored hashed (SHA-256). Access tokens
 * are verified with a single indexed lookup; refresh tokens rotate on every
 * refresh so a stolen refresh token is invalidated by the legitimate client's
 * next refresh.
 */

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function newTokenPair() {
  const accessToken = generateToken();
  const refreshToken = generateToken();
  return {
    accessToken,
    refreshToken,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
  };
}

/** Create a new mobile session (device login) and return plaintext tokens. */
export async function issueTokens(
  userId: string,
  deviceName?: string | null,
): Promise<IssuedTokens> {
  const pair = newTokenPair();

  await db.mobileToken.create({
    data: {
      userId,
      deviceName: deviceName ?? null,
      refreshTokenHash: pair.refreshTokenHash,
      accessTokenHash: pair.accessTokenHash,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
    },
  });

  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    accessTokenExpiresAt: pair.accessTokenExpiresAt,
  };
}

/**
 * Rotate a refresh token: verifies it, replaces both tokens in place, and
 * returns the new pair. Returns null when the token is unknown (revoked or
 * already rotated).
 */
export async function rotateTokens(
  refreshToken: string,
): Promise<IssuedTokens | null> {
  const existing = await db.mobileToken.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    select: { id: true },
  });
  if (!existing) return null;

  const pair = newTokenPair();

  // updateMany + count check makes concurrent rotations of the same token
  // safe: only one caller wins, the other gets null.
  const { count } = await db.mobileToken.updateMany({
    where: { id: existing.id, refreshTokenHash: hashToken(refreshToken) },
    data: {
      refreshTokenHash: pair.refreshTokenHash,
      accessTokenHash: pair.accessTokenHash,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
      lastUsedAt: new Date(),
    },
  });
  if (count === 0) return null;

  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    accessTokenExpiresAt: pair.accessTokenExpiresAt,
  };
}

/** Verify an access token. Returns the owning userId or null. */
export async function verifyAccessToken(
  accessToken: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const row = await db.mobileToken.findUnique({
    where: { accessTokenHash: hashToken(accessToken) },
    select: { id: true, userId: true, accessTokenExpiresAt: true },
  });
  if (!row) return null;
  if (row.accessTokenExpiresAt.getTime() < Date.now()) return null;

  // Fire-and-forget bookkeeping; not worth failing the request over.
  db.mobileToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id };
}

/** Revoke the mobile session that owns this access token. */
export async function revokeByAccessToken(accessToken: string): Promise<void> {
  await db.mobileToken.deleteMany({
    where: { accessTokenHash: hashToken(accessToken) },
  });
}

// Exported for tests — constant-time comparison helper kept here so future
// token formats don't accidentally regress to ===.
export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
