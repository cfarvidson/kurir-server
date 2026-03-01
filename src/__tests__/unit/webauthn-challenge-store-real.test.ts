/**
 * Tests for the actual implemented challenge store at
 * /src/lib/webauthn-challenge-store.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset module state between tests to get a fresh store
// (the store uses globalThis singleton)
beforeEach(() => {
  // Clear globalThis.webauthnChallenges between tests
  const g = globalThis as unknown as { webauthnChallenges: Map<string, unknown> | undefined };
  if (g.webauthnChallenges) {
    g.webauthnChallenges.clear();
  }
});

describe("webauthn-challenge-store (actual implementation)", () => {
  it("stores and retrieves a challenge", async () => {
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );
    setChallenge("key-1", "challenge-abc");
    expect(consumeChallenge("key-1")).toBe("challenge-abc");
  });

  it("challenge is single-use (second consume returns null)", async () => {
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );
    setChallenge("key-1", "challenge");
    consumeChallenge("key-1"); // consume it
    expect(consumeChallenge("key-1")).toBeNull();
  });

  it("returns null for unknown key", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    expect(consumeChallenge("no-such-key")).toBeNull();
  });

  it("expires challenges after TTL", async () => {
    vi.useFakeTimers();
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );

    setChallenge("key-1", "will-expire");
    // Fast-forward past 5 minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(consumeChallenge("key-1")).toBeNull();
    vi.useRealTimers();
  });

  it("does not expire before TTL", async () => {
    vi.useFakeTimers();
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );

    setChallenge("key-1", "still-valid");
    vi.advanceTimersByTime(4 * 60 * 1000); // only 4 minutes

    expect(consumeChallenge("key-1")).toBe("still-valid");
    vi.useRealTimers();
  });

  it("different keys are independent", async () => {
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );
    setChallenge("key-A", "challenge-A");
    setChallenge("key-B", "challenge-B");

    expect(consumeChallenge("key-B")).toBe("challenge-B");
    expect(consumeChallenge("key-A")).toBe("challenge-A");
  });

  it("overwriting the same key replaces the challenge", async () => {
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );
    setChallenge("key-1", "original");
    setChallenge("key-1", "replacement");
    expect(consumeChallenge("key-1")).toBe("replacement");
  });

  it("prunes expired entries when a new challenge is set", async () => {
    vi.useFakeTimers();
    const { setChallenge, consumeChallenge } = await import(
      "@/lib/webauthn-challenge-store"
    );

    // Set an entry that will expire
    setChallenge("expired-key", "old-challenge");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Set a new entry (triggers opportunistic pruning)
    setChallenge("new-key", "fresh-challenge");

    // The expired key should be gone
    expect(consumeChallenge("expired-key")).toBeNull();
    // The new key should still work
    expect(consumeChallenge("new-key")).toBe("fresh-challenge");
    vi.useRealTimers();
  });
});
