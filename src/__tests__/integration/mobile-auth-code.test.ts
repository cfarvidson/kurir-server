/**
 * Integration tests for the web-session mobile login endpoints:
 * - POST /api/mobile/auth/code           (session-authenticated mint)
 * - POST /api/mobile/auth/code/exchange  (PKCE code → bearer tokens)
 *
 * The one-time code store is real (in-memory singleton) so mint and exchange
 * share state; only auth, db and rate-limit are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, randomBytes } from "crypto";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    mobileToken: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitMobileLogin: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function makeRequest(body?: unknown, headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as any;
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function mint(codeChallenge: string) {
  const { POST } = await import("@/app/api/mobile/auth/code/route");
  return POST(makeRequest({ codeChallenge }));
}

async function exchange(body: unknown) {
  const { POST } = await import("@/app/api/mobile/auth/code/exchange/route");
  return POST(makeRequest(body));
}

describe("mobile web-session login", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.create).mockResolvedValue({} as any);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      displayName: "Test User",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) mint without a session returns 401", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as any);

    const res = await mint(pkcePair().challenge);
    expect(res.status).toBe(401);
  });

  it("(b) exchange with the correct verifier returns 200 and tokens", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    const { verifier, challenge } = pkcePair();

    const mintRes = await mint(challenge);
    expect(mintRes.status).toBe(200);
    const { code } = await mintRes.json();
    expect(code).toBeTruthy();

    const res = await exchange({
      code,
      codeVerifier: verifier,
      deviceName: "iPhone 16",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.accessTokenExpiresAt).toBeTruthy();
    expect(body.user).toEqual({ id: "user-1", displayName: "Test User" });
  });

  it("(c) exchange with a wrong verifier returns 400", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    const { challenge } = pkcePair();

    const mintRes = await mint(challenge);
    const { code } = await mintRes.json();

    const res = await exchange({
      code,
      codeVerifier: randomBytes(32).toString("base64url"), // mismatched
      deviceName: "iPhone 16",
    });
    expect(res.status).toBe(400);
  });

  it("(d) using the same code twice returns 400 on the second attempt", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    const { verifier, challenge } = pkcePair();

    const mintRes = await mint(challenge);
    const { code } = await mintRes.json();

    const first = await exchange({ code, codeVerifier: verifier });
    expect(first.status).toBe(200);

    const second = await exchange({ code, codeVerifier: verifier });
    expect(second.status).toBe(400);
  });

  it("(e) an expired code returns 400", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    const { verifier, challenge } = pkcePair();

    const mintRes = await mint(challenge);
    const { code } = await mintRes.json();

    // Advance past the 5-minute TTL for the exchange's expiry check.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 6 * 60 * 1000);

    const res = await exchange({ code, codeVerifier: verifier });
    expect(res.status).toBe(400);
  });
});
