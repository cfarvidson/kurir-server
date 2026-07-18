/**
 * Integration tests for the mobile auth endpoints:
 * - POST /api/mobile/auth/refresh (token rotation)
 * - DELETE /api/mobile/auth/logout (revocation)
 * - Token module semantics (hashing, rotation, expiry)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mobileToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
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

describe("mobile token module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issueTokens stores hashes, not plaintext", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.create).mockResolvedValue({} as any);

    const { issueTokens } = await import("@/lib/mobile/tokens");
    const tokens = await issueTokens("user-1", "iPhone");

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);

    const data = vi.mocked(db.mobileToken.create).mock.calls[0][0].data as any;
    expect(data.userId).toBe("user-1");
    expect(data.deviceName).toBe("iPhone");
    // 64-char hex sha256 digests, never the plaintext token
    expect(data.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.accessTokenHash).not.toBe(tokens.accessToken);
    expect(data.refreshTokenHash).not.toBe(tokens.refreshToken);
  });

  it("verifyAccessToken rejects expired tokens", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "user-1",
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    } as any);

    const { verifyAccessToken } = await import("@/lib/mobile/tokens");
    expect(await verifyAccessToken("some-token")).toBeNull();
  });

  it("verifyAccessToken accepts valid tokens", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "user-1",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    } as any);
    vi.mocked(db.mobileToken.update).mockResolvedValue({} as any);

    const { verifyAccessToken } = await import("@/lib/mobile/tokens");
    const result = await verifyAccessToken("some-token");
    expect(result).toEqual({ userId: "user-1", tokenId: "t1" });
  });

  it("rotateTokens returns null for unknown refresh token", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue(null);

    const { rotateTokens } = await import("@/lib/mobile/tokens");
    expect(await rotateTokens("unknown")).toBeNull();
  });

  it("rotateTokens returns null when a concurrent rotation won", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue({ id: "t1" } as any);
    vi.mocked(db.mobileToken.updateMany).mockResolvedValue({ count: 0 });

    const { rotateTokens } = await import("@/lib/mobile/tokens");
    expect(await rotateTokens("stolen-or-stale")).toBeNull();
  });

  it("rotateTokens issues a fresh pair on success", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue({ id: "t1" } as any);
    vi.mocked(db.mobileToken.updateMany).mockResolvedValue({ count: 1 });

    const { rotateTokens } = await import("@/lib/mobile/tokens");
    const tokens = await rotateTokens("valid-refresh");
    expect(tokens?.accessToken).toBeTruthy();
    expect(tokens?.refreshToken).toBeTruthy();
    expect(tokens?.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("POST /api/mobile/auth/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when refreshToken is missing", async () => {
    const { POST } = await import("@/app/api/mobile/auth/refresh/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 401 for an unknown refresh token", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mobile/auth/refresh/route");
    const res = await POST(makeRequest({ refreshToken: "nope" }));
    expect(res.status).toBe(401);
  });

  it("returns a new token pair for a valid refresh token", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.findUnique).mockResolvedValue({ id: "t1" } as any);
    vi.mocked(db.mobileToken.updateMany).mockResolvedValue({ count: 1 });

    const { POST } = await import("@/app/api/mobile/auth/refresh/route");
    const res = await POST(makeRequest({ refreshToken: "valid" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.accessTokenExpiresAt).toBeTruthy();
  });
});

describe("DELETE /api/mobile/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes the presented token", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mobileToken.deleteMany).mockResolvedValue({ count: 1 });

    const { DELETE } = await import("@/app/api/mobile/auth/logout/route");
    const res = await DELETE(
      makeRequest(undefined, { authorization: "Bearer abc123" }),
    );
    expect(res.status).toBe(200);
    expect(db.mobileToken.deleteMany).toHaveBeenCalled();
  });

  it("succeeds without a token (already logged out)", async () => {
    const { db } = await import("@/lib/db");

    const { DELETE } = await import("@/app/api/mobile/auth/logout/route");
    const res = await DELETE(makeRequest(undefined));
    expect(res.status).toBe(200);
    expect(db.mobileToken.deleteMany).not.toHaveBeenCalled();
  });
});
