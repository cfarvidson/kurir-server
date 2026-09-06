import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitOAuth: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

describe("rateLimitOAuthAuthorize", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns HTTP 429 text and Retry-After when over limit", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitOAuth).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 42,
    });
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    const res = await rateLimitOAuthAuthorize(
      "/oauth/authorize",
      "GET",
      new Headers({ "x-real-ip": "1.2.3.4" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBe("42");
    expect(res!.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await res!.text()).toBe("Too many requests");
    expect(rateLimitOAuth).toHaveBeenCalledWith("1.2.3.4");
  });

  it("returns null when the request is allowed", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitOAuth).mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    });
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    const res = await rateLimitOAuthAuthorize(
      "/oauth/authorize",
      "GET",
      new Headers(),
    );
    expect(res).toBeNull();
  });

  it("does not rate-limit other paths", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitOAuth).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 42,
    });
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    const res = await rateLimitOAuthAuthorize("/login", "GET", new Headers());
    expect(res).toBeNull();
    expect(rateLimitOAuth).not.toHaveBeenCalled();
  });

  it("does not rate-limit authorize POST (server actions)", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    const res = await rateLimitOAuthAuthorize(
      "/oauth/authorize",
      "POST",
      new Headers(),
    );
    expect(res).toBeNull();
    expect(rateLimitOAuth).not.toHaveBeenCalled();
  });

  it("prefers X-Real-IP over a spoofed leftmost X-Forwarded-For hop", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    await rateLimitOAuthAuthorize(
      "/oauth/authorize",
      "GET",
      new Headers({
        "x-forwarded-for": "8.8.8.8, 203.0.113.10",
        "x-real-ip": "1.2.3.4",
      }),
    );
    expect(rateLimitOAuth).toHaveBeenCalledWith("1.2.3.4");
  });

  it("uses the rightmost X-Forwarded-For hop when X-Real-IP is absent", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    await rateLimitOAuthAuthorize(
      "/oauth/authorize",
      "GET",
      new Headers({ "x-forwarded-for": "8.8.8.8, 203.0.113.10" }),
    );
    expect(rateLimitOAuth).toHaveBeenCalledWith("203.0.113.10");
  });

  it("keys the limiter on unknown when no forwarding headers are present", async () => {
    const { rateLimitOAuth } = await import("@/lib/rate-limit");
    const { rateLimitOAuthAuthorize } =
      await import("@/lib/mcp/oauth-rate-limit");
    await rateLimitOAuthAuthorize("/oauth/authorize", "GET", new Headers());
    expect(rateLimitOAuth).toHaveBeenCalledWith("unknown");
  });
});
