/**
 * Demo-instance gates: with DEMO_LOGIN_* set, sync is a successful no-op
 * and outbound send fails fast with a clear message (fictional IMAP/SMTP
 * hosts must never be contacted). Without the vars, nothing is gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/mobile/auth", () => ({
  getRequestUserId: vi.fn().mockResolvedValue("user-demo"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitSend: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function makeRequest(body?: unknown) {
  return {
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as any;
}

describe("demo-instance gates", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_LOGIN_EMAIL", "alex@kurir.io");
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "x");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isDemoInstance reflects the env pair", async () => {
    const { isDemoInstance } = await import("@/lib/demo");
    expect(isDemoInstance()).toBe(true);
    vi.stubEnv("DEMO_LOGIN_PASSWORD", "");
    expect(isDemoInstance()).toBe(false);
  });

  it("syncEmailConnection is a successful no-op in demo mode", async () => {
    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");
    expect(result).toEqual({ success: true, results: [] });
    // The credentials lookup (first real step) must never run.
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    expect(getConnectionCredentialsInternal).not.toHaveBeenCalled();
  });

  it("send route fails fast with the demo message", async () => {
    const { POST } = await import("@/app/api/mail/send/route");
    const res = await POST(makeRequest({ to: "x@example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("demo instance");
  });
});
