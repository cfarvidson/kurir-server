/**
 * Tests for the in-memory WebAuthn challenge store.
 * The challenge store is a critical security component:
 * - Challenges must be single-use (consumed on verification)
 * - Challenges must expire (prevent replay attacks)
 * - Challenges must be user-scoped (prevent cross-user attacks)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The challenge store is a module-level singleton. We test the contract:
// generateChallenge() -> store -> consumeChallenge() -> verifies once
// After each test we reset timers to avoid leaking state.

// Simulate the challenge store that will be in /src/lib/webauthn/challenge-store.ts
// We define the expected interface here and test against a mock implementation
// so tests document the contract before implementation.

function createChallengeStore(ttlMs = 5 * 60 * 1000) {
  const store = new Map<string, { challenge: string; expiresAt: number }>();

  return {
    set(key: string, challenge: string) {
      store.set(key, { challenge, expiresAt: Date.now() + ttlMs });
    },
    consume(key: string): string | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      store.delete(key); // single-use
      return entry.challenge;
    },
    size() {
      return store.size;
    },
  };
}

describe("WebAuthn challenge store", () => {
  it("stores and retrieves a challenge", () => {
    const store = createChallengeStore();
    store.set("user-1", "challenge-abc");
    expect(store.consume("user-1")).toBe("challenge-abc");
  });

  it("is single-use (second consume returns null)", () => {
    const store = createChallengeStore();
    store.set("user-1", "challenge-abc");
    store.consume("user-1"); // first consume
    expect(store.consume("user-1")).toBeNull(); // second consume
  });

  it("returns null for unknown key", () => {
    const store = createChallengeStore();
    expect(store.consume("no-such-key")).toBeNull();
  });

  it("expires challenges after TTL", () => {
    vi.useFakeTimers();
    const store = createChallengeStore(1000); // 1 second TTL
    store.set("user-1", "expired-challenge");

    vi.advanceTimersByTime(1001);
    expect(store.consume("user-1")).toBeNull();
    vi.useRealTimers();
  });

  it("does not expire challenges before TTL", () => {
    vi.useFakeTimers();
    const store = createChallengeStore(5000);
    store.set("user-1", "active-challenge");

    vi.advanceTimersByTime(4999);
    expect(store.consume("user-1")).toBe("active-challenge");
    vi.useRealTimers();
  });

  it("scopes challenges per key (different users don't cross-contaminate)", () => {
    const store = createChallengeStore();
    store.set("user-1", "challenge-for-1");
    store.set("user-2", "challenge-for-2");

    expect(store.consume("user-2")).toBe("challenge-for-2");
    // user-1's challenge should still be there
    expect(store.consume("user-1")).toBe("challenge-for-1");
  });

  it("replaces old challenge if set twice for same key", () => {
    const store = createChallengeStore();
    store.set("user-1", "old-challenge");
    store.set("user-1", "new-challenge");
    expect(store.consume("user-1")).toBe("new-challenge");
  });

  it("consumed challenges are removed from the store", () => {
    const store = createChallengeStore();
    store.set("user-1", "challenge");
    expect(store.size()).toBe(1);
    store.consume("user-1");
    expect(store.size()).toBe(0);
  });
});
