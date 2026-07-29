/**
 * Integration tests for POST /api/auth/demo-login — the DEMO-instance
 * password sign-in (App Store review path). The route must be a hard 404
 * unless both DEMO_LOGIN_* env vars are set, and can only ever sign in
 * the user behind the demo EmailConnection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn().mockReturnValue({
    nextauthSecret: "test-secret",
    isProduction: false,
  }),
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

async function demoLogin(body?: unknown) {
  const { POST } = await import("@/app/api/auth/demo-login/route");
  return POST(makeRequest(body));
}

describe("POST /api/auth/demo-login", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_LOGIN_EMAIL", "alex@kurir.io");
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "demo-pass-123");
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      email: "alex@kurir.io",
      user: { id: "user-demo", role: "user" },
    } as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 404 when the demo env vars are not set", async () => {
    vi.stubEnv("DEMO_LOGIN_EMAIL", "");
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "");
    const res = await demoLogin({
      email: "alex@kurir.io",
      password: "demo-pass-123",
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 for a wrong password", async () => {
    const res = await demoLogin({
      email: "alex@kurir.io",
      password: "wrong",
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a non-demo email even with the right password", async () => {
    const res = await demoLogin({
      email: "other@kurir.io",
      password: "demo-pass-123",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing body", async () => {
    const res = await demoLogin(undefined);
    expect(res.status).toBe(400);
  });

  it("signs in with correct credentials and sets the session cookie", async () => {
    const res = await demoLogin({
      email: "Alex@kurir.io", // email match is case-insensitive
      password: "demo-pass-123",
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("authjs.session-token=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("returns 500 when no connection matches the demo email", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);
    const res = await demoLogin({
      email: "alex@kurir.io",
      password: "demo-pass-123",
    });
    expect(res.status).toBe(500);
  });

  it("returns 429 when rate limited", async () => {
    const { rateLimitMobileLogin } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitMobileLogin).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });
    const res = await demoLogin({
      email: "alex@kurir.io",
      password: "demo-pass-123",
    });
    expect(res.status).toBe(429);
  });
});
