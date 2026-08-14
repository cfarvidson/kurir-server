import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mcpToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("mcp tokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issueMcpTokens stores hashes, not plaintext", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpToken.create).mockResolvedValue({} as never);
    const { issueMcpTokens } = await import("@/lib/mcp/tokens");
    const tokens = await issueMcpTokens({
      userId: "user-1",
      clientId: "https://claude.ai/oauth/claude.json",
      clientName: "Claude",
      resource: "https://mail.example/mcp",
    });
    const data = vi.mocked(db.mcpToken.create).mock.calls[0][0].data as {
      accessTokenHash: string;
      refreshTokenHash: string;
      resource: string;
    };
    expect(data.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.accessTokenHash).not.toBe(tokens.accessToken);
    expect(data.resource).toBe("https://mail.example/mcp");
  });

  it("verifyMcpAccessToken rejects expired, wrong audience, and unknown", async () => {
    const { db } = await import("@/lib/db");
    const { verifyMcpAccessToken } = await import("@/lib/mcp/tokens");
    vi.mocked(db.mcpToken.findUnique).mockResolvedValue(null);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();

    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "u1",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      resource: "https://other/mcp",
    } as never);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();

    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "u1",
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      resource: "https://mail.example/mcp",
    } as never);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();
  });

  it("rotateMcpTokens returns null when a concurrent rotation won", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      resource: "https://mail.example/mcp",
    } as never);
    vi.mocked(db.mcpToken.updateMany).mockResolvedValue({ count: 0 });
    const { rotateMcpTokens } = await import("@/lib/mcp/tokens");
    expect(
      await rotateMcpTokens("refresh", "https://mail.example/mcp"),
    ).toBeNull();
  });
});
