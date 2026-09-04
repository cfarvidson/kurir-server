/**
 * HTTP fronts for the on-demand IMAP check (kurir-server#161).
 * Cookie: POST /api/mail/check. Bearer: POST /api/mobile/check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

vi.mock("@/lib/mail/check-new-mail", () => ({
  checkNewMailForUser: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new Request("http://localhost/api/mail/check", {
    method: "POST",
  }) as unknown as NextRequest;
}

describe("POST /api/mail/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a session cookie", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { POST } = await import("@/app/api/mail/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns ingested count for a cookie session", async () => {
    const { auth } = await import("@/lib/auth");
    const { checkNewMailForUser } = await import("@/lib/mail/check-new-mail");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(checkNewMailForUser).mockResolvedValue({
      status: "ok",
      ingested: 2,
    });

    const { POST } = await import("@/app/api/mail/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ingested: 2 });
    expect(checkNewMailForUser).toHaveBeenCalledWith("user-1");
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    const { auth } = await import("@/lib/auth");
    const { checkNewMailForUser } = await import("@/lib/mail/check-new-mail");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(checkNewMailForUser).mockResolvedValue({
      status: "rate_limited",
      retryAfter: 4,
    });

    const { POST } = await import("@/app/api/mail/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
  });
});

describe("POST /api/mobile/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mobile/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    const { checkNewMailForUser } = await import("@/lib/mail/check-new-mail");
    vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "user-1" });
    vi.mocked(checkNewMailForUser).mockResolvedValue({
      status: "rate_limited",
      retryAfter: 4,
    });

    const { POST } = await import("@/app/api/mobile/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
  });

  it("returns ingested count for a bearer session", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    const { checkNewMailForUser } = await import("@/lib/mail/check-new-mail");
    vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "user-1" });
    vi.mocked(checkNewMailForUser).mockResolvedValue({
      status: "ok",
      ingested: 0,
    });

    const { POST } = await import("@/app/api/mobile/check/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ingested: 0 });
    expect(checkNewMailForUser).toHaveBeenCalledWith("user-1");
  });
});
