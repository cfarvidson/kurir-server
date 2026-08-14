import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/oauth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/mcp/oauth")>("@/lib/mcp/oauth");
  return {
    ...actual,
    consumeAuthorizationCode: vi.fn(),
    verifyPkce: vi.fn(),
    mcpResourceUri: () => "https://mail.example/mcp",
    fetchCimd: vi.fn().mockResolvedValue({
      client_id: "https://ok.example/c.json",
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb"],
    }),
  };
});

vi.mock("@/lib/mcp/tokens", () => ({
  issueMcpTokens: vi.fn().mockResolvedValue({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  }),
  rotateMcpTokens: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitOAuth: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function form(data: Record<string, string>) {
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
}

describe("POST /api/oauth/token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a bad PKCE verifier", async () => {
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(oauth.consumeAuthorizationCode).mockResolvedValue({
      userId: "u1",
      codeChallenge: "chal",
    });
    vi.mocked(oauth.verifyPkce).mockReturnValue(false);
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code: "x",
        redirect_uri: "https://claude.ai/cb",
        client_id: "https://ok.example/c.json",
        code_verifier: "nope",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("issues tokens for a valid code", async () => {
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(oauth.consumeAuthorizationCode).mockResolvedValue({
      userId: "u1",
      codeChallenge: "chal",
    });
    vi.mocked(oauth.verifyPkce).mockReturnValue(true);
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code: "x",
        redirect_uri: "https://claude.ai/cb",
        client_id: "https://ok.example/c.json",
        code_verifier: "yes",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("access");
    expect(body.token_type).toBe("Bearer");
    expect(body.refresh_token).toBe("refresh");
    expect(body.expires_in).toBe(3600);
    const tokens = await import("@/lib/mcp/tokens");
    expect(tokens.issueMcpTokens).toHaveBeenCalledWith({
      userId: "u1",
      clientId: "https://ok.example/c.json",
      clientName: "Claude",
      resource: "https://mail.example/mcp",
    });
  });

  it("rotates tokens for a refresh grant", async () => {
    const tokens = await import("@/lib/mcp/tokens");
    vi.mocked(tokens.rotateMcpTokens).mockResolvedValue({
      accessToken: "access2",
      refreshToken: "refresh2",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "refresh_token",
        refresh_token: "r",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("access2");
    expect(body.refresh_token).toBe("refresh2");
    expect(body.token_type).toBe("Bearer");
  });

  it("rejects an unknown refresh token", async () => {
    const tokens = await import("@/lib/mcp/tokens");
    vi.mocked(tokens.rotateMcpTokens).mockResolvedValue(null);
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "refresh_token",
        refresh_token: "gone",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });
});
