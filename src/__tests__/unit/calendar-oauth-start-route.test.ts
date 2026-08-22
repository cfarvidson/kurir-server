import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
  getRequestUserId: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    isProduction: false,
    oauth: {
      google: { clientId: "google-client", clientSecret: "google-secret" },
      microsoft: { clientId: "ms-client", clientSecret: "ms-secret" },
    },
    encryptionKey: "test-encryption-key-32-bytes-long",
    baseUrl: "http://localhost:3000",
  }),
}));

vi.mock("@/lib/calendar/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/oauth")>();
  return {
    ...actual,
    isCalendarOAuthEnabled: vi.fn(() => true),
    getCalendarOAuthRedirectUri: vi.fn(
      () => "http://localhost:3000/api/calendar/oauth/callback",
    ),
    buildCalendarAuthorizationUrl: vi.fn(
      () => "https://accounts.google.com/o/oauth2/v2/auth?state=s",
    ),
    signCalendarOAuthState: vi.fn(() => "signed-state"),
  };
});

function startRequest(query: string, headers?: Record<string, string>) {
  return new NextRequest(
    `http://localhost:3000/api/calendar/oauth/start?${query}`,
    { headers },
  );
}

describe("GET /api/calendar/oauth/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a mobile bearer token when mobile=1", async () => {
    const { requireMobileAuth, getRequestUserId } = await import(
      "@/lib/mobile/auth"
    );
    const { auth } = await import("@/lib/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "mobile-user" });
    vi.mocked(getRequestUserId).mockResolvedValue(null);
    vi.mocked(auth).mockResolvedValue(null as never);

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const res = await GET(
      startRequest("provider=google&mobile=1", {
        authorization: "Bearer tok-mobile",
      }),
    );

    expect(requireMobileAuth).toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: string };
    expect(body.url).toContain("accounts.google.com");
  });

  it("returns 401 when mobile=1 has no bearer or session", async () => {
    const { requireMobileAuth, getRequestUserId } = await import(
      "@/lib/mobile/auth"
    );
    vi.mocked(requireMobileAuth).mockResolvedValue(null);
    vi.mocked(getRequestUserId).mockResolvedValue(null);

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const res = await GET(startRequest("provider=google&mobile=1"));

    expect(requireMobileAuth).toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});
