/**
 * In-memory challenge store for WebAuthn registration and authentication.
 *
 * Challenges are short-lived (5 minutes) and single-use. For a single-server
 * personal project this is sufficient — no need for Redis or DB-backed storage.
 *
 * Uses a globalThis singleton so the store survives Next.js HMR restarts in dev.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

const globalForChallenges = globalThis as unknown as {
  webauthnChallenges: Map<string, ChallengeEntry> | undefined;
};

const challengeStore: Map<string, ChallengeEntry> =
  globalForChallenges.webauthnChallenges ??
  new Map<string, ChallengeEntry>();

if (!globalForChallenges.webauthnChallenges) {
  globalForChallenges.webauthnChallenges = challengeStore;
}

/**
 * Save a challenge keyed by a session identifier (e.g. a random token stored in a cookie).
 */
export function setChallenge(sessionKey: string, challenge: string): void {
  // Prune expired entries opportunistically to avoid unbounded growth
  const now = Date.now();
  for (const [key, entry] of challengeStore.entries()) {
    if (entry.expiresAt < now) {
      challengeStore.delete(key);
    }
  }

  challengeStore.set(sessionKey, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

/**
 * Retrieve and consume a challenge. Returns null if missing or expired.
 * Challenges are single-use: they are deleted after retrieval.
 */
export function consumeChallenge(sessionKey: string): string | null {
  const entry = challengeStore.get(sessionKey);
  if (!entry) return null;

  challengeStore.delete(sessionKey);

  if (entry.expiresAt < Date.now()) return null;

  return entry.challenge;
}
