/**
 * In-memory one-time code store for the web-session mobile login flow.
 *
 * Codes are short-lived (5 minutes) and single-use, mirroring
 * webauthn-challenge-store. Each code binds a userId to the PKCE
 * codeChallenge the app supplied, so exchange can verify the caller holds
 * the matching verifier. A globalThis singleton survives Next.js HMR in dev.
 */
import { randomBytes } from "crypto";

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface AuthCodeEntry {
  userId: string;
  codeChallenge: string;
  expiresAt: number;
}

const globalForAuthCodes = globalThis as unknown as {
  mobileAuthCodes: Map<string, AuthCodeEntry> | undefined;
};

const codeStore: Map<string, AuthCodeEntry> =
  globalForAuthCodes.mobileAuthCodes ?? new Map<string, AuthCodeEntry>();

if (!globalForAuthCodes.mobileAuthCodes) {
  globalForAuthCodes.mobileAuthCodes = codeStore;
}

/**
 * Mint a one-time code for a user, bound to the given PKCE codeChallenge.
 * Returns the plaintext code (a 32-byte base64url random string).
 */
export function createAuthCode(userId: string, codeChallenge: string): string {
  const now = Date.now();
  // Prune expired entries opportunistically to avoid unbounded growth.
  for (const [key, entry] of codeStore.entries()) {
    if (entry.expiresAt < now) {
      codeStore.delete(key);
    }
  }

  const code = randomBytes(32).toString("base64url");
  codeStore.set(code, {
    userId,
    codeChallenge,
    expiresAt: now + CODE_TTL_MS,
  });
  return code;
}

/**
 * Retrieve and consume a code. Returns null if missing or expired.
 * Codes are single-use: they are deleted on retrieval.
 */
export function consumeAuthCode(
  code: string,
): { userId: string; codeChallenge: string } | null {
  const entry = codeStore.get(code);
  if (!entry) return null;

  codeStore.delete(code);

  if (entry.expiresAt < Date.now()) return null;

  return { userId: entry.userId, codeChallenge: entry.codeChallenge };
}
