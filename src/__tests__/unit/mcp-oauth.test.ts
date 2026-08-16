import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mcpAuthorizationCode: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("pkce and canonical json", () => {
  it("S256 round-trips and rejects a wrong verifier", async () => {
    const { generateCodeVerifier, codeChallengeS256, verifyPkce } =
      await import("@/lib/mcp/oauth");
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("other", challenge)).toBe(false);
  });

  it("canonicalJson sorts keys so hashes are stable", async () => {
    const { canonicalJson, hashArgs } =
      await import("@/lib/mcp/canonical-json");
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(hashArgs({ z: 1, a: 2 })).toBe(hashArgs({ a: 2, z: 1 }));
  });
});

describe("CIMD", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects non-https client_id and missing redirect", async () => {
    const { fetchCimd } = await import("@/lib/mcp/oauth");
    expect(await fetchCimd("http://evil.example/client.json")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ client_id: "https://ok.example/c.json" }),
      }),
    );
    expect(await fetchCimd("https://ok.example/c.json")).toBeNull();
  });

  it("accepts a valid document", async () => {
    const { fetchCimd } = await import("@/lib/mcp/oauth");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          client_id: "https://ok.example/c.json",
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      }),
    );
    const doc = await fetchCimd("https://ok.example/c.json");
    expect(doc?.client_name).toBe("Claude");
  });

  it("redirectUriAllowed matches loopback redirects on any port (RFC 8252 §7.3)", async () => {
    const { redirectUriAllowed } = await import("@/lib/mcp/oauth");
    const doc = {
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      redirect_uris: [
        "http://localhost/callback",
        "http://127.0.0.1/callback",
        "https://app.example/cb",
      ],
    };
    expect(redirectUriAllowed(doc, "http://localhost:3118/callback")).toBe(true);
    expect(redirectUriAllowed(doc, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectUriAllowed(doc, "http://localhost/callback")).toBe(true);
    expect(redirectUriAllowed(doc, "https://app.example/cb")).toBe(true);
    // Different path, host, scheme, or a non-loopback port change are rejected.
    expect(redirectUriAllowed(doc, "http://localhost:3118/other")).toBe(false);
    expect(redirectUriAllowed(doc, "http://evil.example/callback")).toBe(false);
    expect(redirectUriAllowed(doc, "https://localhost:3118/callback")).toBe(false);
    expect(redirectUriAllowed(doc, "https://app.example:8443/cb")).toBe(false);
    expect(redirectUriAllowed(doc, "not a url")).toBe(false);
  });
});

describe("authorization codes", () => {
  it("consumeAuthorizationCode is one-time and checks binding", async () => {
    const { db } = await import("@/lib/db");
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(db.mcpAuthorizationCode.create).mockResolvedValue({} as never);
    const code = await oauth.createAuthorizationCode({
      userId: "u1",
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "abc",
      resource: "https://mail.example/mcp",
    });
    vi.mocked(db.mcpAuthorizationCode.findUnique).mockResolvedValue({
      id: "c1",
      userId: "u1",
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "abc",
      resource: "https://mail.example/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(db.mcpAuthorizationCode.delete).mockResolvedValue({} as never);
    const ok = await oauth.consumeAuthorizationCode({
      code,
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      resource: "https://mail.example/mcp",
    });
    expect(ok).toEqual({ userId: "u1", codeChallenge: "abc" });
    const bad = await oauth.consumeAuthorizationCode({
      code,
      clientId: "https://ok.example/c.json",
      redirectUri: "https://evil.example/cb",
      resource: "https://mail.example/mcp",
    });
    expect(bad).toBeNull();
  });
});

describe("metadata and cors", () => {
  it("protected resource and AS metadata match the discovery spec", async () => {
    const {
      MCP_PROTOCOL_VERSION,
      MCP_SCOPE,
      mcpResourceUri,
      mcpIssuer,
      protectedResourceMetadata,
      authorizationServerMetadata,
    } = await import("@/lib/mcp/oauth");
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(MCP_SCOPE).toBe("kurir");
    expect(mcpResourceUri()).toBe(`${mcpIssuer()}/mcp`);
    expect(protectedResourceMetadata()).toEqual({
      resource: mcpResourceUri(),
      authorization_servers: [mcpIssuer()],
      scopes_supported: ["kurir"],
      bearer_methods_supported: ["header"],
    });
    const as = authorizationServerMetadata();
    expect(as.issuer).toBe(mcpIssuer());
    expect(as.authorization_endpoint).toBe(`${mcpIssuer()}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${mcpIssuer()}/api/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.response_types_supported).toEqual(["code"]);
    expect(as.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as).not.toHaveProperty("registration_endpoint");
  });

  it("cors helpers advertise GET/POST and MCP headers", async () => {
    const { corsHeaders, corsPreflight } = await import("@/lib/mcp/cors");
    const headers = corsHeaders("GET, OPTIONS");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toContain(
      "MCP-Protocol-Version",
    );
    const preflight = corsPreflight("GET, OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
