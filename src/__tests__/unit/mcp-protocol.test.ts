import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/tools", () => {
  const tools = new Map();
  return {
    registerTool: (d: { name: string }) => tools.set(d.name, d),
    listTools: () => [...tools.values()],
    getTool: (n: string) => tools.get(n),
  };
});

vi.mock("@/lib/mcp/tokens", () => ({
  verifyMcpAccessToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function headers(h: Record<string, string>) {
  return new Headers(h);
}

describe("dispatchMcp", () => {
  beforeEach(() => vi.resetModules());

  it("rejects the wrong protocol version", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2025-11-25",
        "Mcp-Method": "server/discover",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(res.json).toMatchObject({
      error: { message: expect.stringContaining("2026-07-28") },
    });
  });

  it("rejects header/body method mismatch", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect((res.json as { error?: unknown }).error).toBeTruthy();
  });

  it("server/discover lists tools capability only", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      result: { capabilities: { tools: {} } },
    });
    expect(
      (res.json as { result: { capabilities: Record<string, unknown> } }).result
        .capabilities.resources,
    ).toBeUndefined();
    expect(
      (res.json as { result: { serverInfo: { name: string } } }).result
        .serverInfo.name,
    ).toBe("kurir");
  });

  it("rejects Mcp-Name mismatch on tools/call", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "other",
      }),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_mail" },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect((res.json as { error?: { code?: number } }).error?.code).toBe(
      -32600,
    );
  });

  it("returns JSON-RPC error for unknown method and tool", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const unknownMethod = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "prompts/list",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "prompts/list" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(
      (unknownMethod.json as { error?: { code?: number } }).error?.code,
    ).toBe(-32601);

    const unknownTool = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "nope",
      }),
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "nope" },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect(
      (unknownTool.json as { error?: { code?: number } }).error?.code,
    ).toBe(-32602);
  });

  it("tools/list returns catalog cache fields", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(res.json).toMatchObject({
      result: { ttlMs: 300000, cacheScope: "server" },
    });
    expect(
      Array.isArray(
        (res.json as { result: { tools: unknown[] } }).result.tools,
      ),
    ).toBe(true);
  });

  it("tools/call maps ok, error, and input_required", async () => {
    const { registerTool } = await import("@/lib/mcp/tools");
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    registerTool({
      name: "echo_ok",
      description: "ok",
      inputSchema: { type: "object" },
      handler: async (_ctx, args) => ({
        type: "ok",
        structuredContent: args,
        text: "done",
      }),
    });
    registerTool({
      name: "echo_err",
      description: "err",
      inputSchema: { type: "object" },
      handler: async () => ({
        type: "error",
        message: "not found or not yours",
      }),
    });
    registerTool({
      name: "echo_confirm",
      description: "confirm",
      inputSchema: { type: "object" },
      handler: async () => ({
        type: "input_required",
        requestState: "h1",
        message: "Send this mail?",
      }),
    });

    const ok = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo_ok",
      }),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo_ok", arguments: { q: "hi" } },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect(ok.json).toMatchObject({
      result: {
        content: [{ type: "text", text: "done" }],
        structuredContent: { q: "hi" },
        isError: false,
      },
    });

    const err = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo_err",
      }),
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo_err" },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect(err.json).toMatchObject({
      result: { isError: true },
    });

    const confirm = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo_confirm",
      }),
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo_confirm" },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect(confirm.json).toMatchObject({
      result: {
        resultType: "input_required",
        requestState: "h1",
        inputRequests: {
          confirm: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: "Send this mail?",
              requestedSchema: { type: "object", properties: {} },
            },
          },
        },
      },
    });
  });

  it("sets hasElicitation from clientCapabilities", async () => {
    const { registerTool } = await import("@/lib/mcp/tools");
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const seen: { hasElicitation?: boolean } = {};
    registerTool({
      name: "cap_probe",
      description: "probe",
      inputSchema: { type: "object" },
      handler: async (ctx) => {
        seen.hasElicitation = ctx.hasElicitation;
        return { type: "ok", structuredContent: {} };
      },
    });
    await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "cap_probe",
      }),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "cap_probe",
          _meta: {
            "io.modelcontextprotocol/clientCapabilities": {
              elicitation: {},
            },
          },
        },
      },
      userId: "u1",
      tokenId: "t1",
    });
    expect(seen.hasElicitation).toBe(true);
  });
});

describe("unauthorizedResponse", () => {
  it("returns 401 with resource_metadata and kurir scope", async () => {
    const { unauthorizedResponse } = await import("@/lib/mcp/auth");
    const { mcpIssuer, MCP_SCOPE } = await import("@/lib/mcp/oauth");
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${mcpIssuer()}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`,
    );
  });
});

describe("POST /mcp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect(res.headers.get("WWW-Authenticate")).toContain('scope="kurir"');
  });

  it("dispatches server/discover when the token is valid", async () => {
    const tokens = await import("@/lib/mcp/tokens");
    vi.mocked(tokens.verifyMcpAccessToken).mockResolvedValue({
      userId: "u1",
      tokenId: "t1",
    });
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "server/discover",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      result: { capabilities: { tools: {} } },
    });
  });

  it("GET and DELETE return 405 and OPTIONS is a CORS preflight", async () => {
    const { GET, DELETE, OPTIONS } = await import("@/app/mcp/route");
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
