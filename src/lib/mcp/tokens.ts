import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

/**
 * Bearer-token auth for MCP remote HTTP clients.
 *
 * Both tokens are opaque random values stored hashed (SHA-256). Access tokens
 * are verified with a single indexed lookup plus audience (`resource`) check;
 * refresh tokens rotate on every use so a stolen refresh token is invalidated
 * by the legitimate client's next refresh.
 */

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface IssuedMcpTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export function hashToken(token: string): string {
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

/** Create a new MCP session (OAuth consent) and return plaintext tokens. */
export async function issueMcpTokens(input: {
  userId: string;
  clientId: string;
  clientName: string | null;
  resource: string;
}): Promise<IssuedMcpTokens> {
  const pair = newTokenPair();

  await db.mcpToken.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      clientName: input.clientName,
      resource: input.resource,
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
 * Rotate a refresh token: verifies it and audience, replaces both tokens in
 * place, and returns the new pair. Returns null when the token is unknown
 * (revoked or already rotated), audience mismatches, or a concurrent rotation
 * won.
 */
export async function rotateMcpTokens(
  refreshToken: string,
  expectedResource: string,
): Promise<IssuedMcpTokens | null> {
  const existing = await db.mcpToken.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    select: { id: true, resource: true },
  });
  if (!existing) return null;
  if (existing.resource !== expectedResource) return null;

  const pair = newTokenPair();

  // updateMany + count check makes concurrent rotations of the same token
  // safe: only one caller wins, the other gets null.
  const { count } = await db.mcpToken.updateMany({
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

/**
 * Verify an access token and audience. Returns the owning userId/tokenId or
 * null on unknown, expired, or audience mismatch.
 */
export async function verifyMcpAccessToken(
  accessToken: string,
  expectedResource: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const row = await db.mcpToken.findUnique({
    where: { accessTokenHash: hashToken(accessToken) },
    select: {
      id: true,
      userId: true,
      accessTokenExpiresAt: true,
      resource: true,
    },
  });
  if (!row) return null;
  if (row.resource !== expectedResource) return null;
  if (row.accessTokenExpiresAt.getTime() < Date.now()) return null;

  // Fire-and-forget bookkeeping; not worth failing the request over.
  db.mcpToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id };
}

/** Revoke an MCP session by id, scoped to the owning user. */
export async function revokeMcpTokenById(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const { count } = await db.mcpToken.deleteMany({
    where: { id: tokenId, userId },
  });
  return count > 0;
}

/** Revoke the MCP session that owns this access token. */
export async function revokeMcpTokenByAccessToken(
  accessToken: string,
): Promise<void> {
  await db.mcpToken.deleteMany({
    where: { accessTokenHash: hashToken(accessToken) },
  });
}
