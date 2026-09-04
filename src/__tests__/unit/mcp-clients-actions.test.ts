import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    mcpClient: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    mcpToken: { groupBy: vi.fn(), deleteMany: vi.fn() },
    mcpAuthorizationCode: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("mcp client admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ user: { id: "admin1" } });
  });

  it("createMcpClient stores a kmc_ id with validated redirects", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpClient.create).mockImplementation(
      (async ({ data }: { data: { clientId: string } }) => ({
        id: "row1",
        ...data,
      })) as never,
    );
    const { createMcpClient } = await import("@/actions/mcp-clients");
    const result = await createMcpClient("  Grok Bot ", [
      "https://grok-bot.example/oauth/callback",
      "",
    ]);
    expect(result.id).toBe("row1");
    expect(result.clientId).toMatch(/^kmc_/);
    expect(db.mcpClient.create).toHaveBeenCalledWith({
      data: {
        clientId: result.clientId,
        name: "Grok Bot",
        redirectUris: ["https://grok-bot.example/oauth/callback"],
        createdBy: "admin1",
      },
    });
  });

  it("createMcpClient rejects bad input before touching the database", async () => {
    const { db } = await import("@/lib/db");
    const { createMcpClient } = await import("@/actions/mcp-clients");
    await expect(createMcpClient("", ["https://a.example/cb"])).rejects.toThrow(
      /Name is required/,
    );
    await expect(
      createMcpClient("x", ["http://evil.example/cb"]),
    ).rejects.toThrow(/Redirect URIs/);
    await expect(createMcpClient("x", [])).rejects.toThrow(/Redirect URIs/);
    expect(db.mcpClient.create).not.toHaveBeenCalled();
  });

  it("actions require an admin session", async () => {
    requireAdmin.mockRejectedValue(new Error("Forbidden"));
    const { createMcpClient, deleteMcpClient, listMcpClients } =
      await import("@/actions/mcp-clients");
    await expect(createMcpClient("x", ["https://a.example/cb"])).rejects.toThrow(
      "Forbidden",
    );
    await expect(deleteMcpClient("row1")).rejects.toThrow("Forbidden");
    await expect(listMcpClients()).rejects.toThrow("Forbidden");
  });

  it("deleteMcpClient revokes tokens and codes for that client", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpClient.findUnique).mockResolvedValue({
      id: "row1",
      clientId: "kmc_abc",
    } as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);
    const { deleteMcpClient } = await import("@/actions/mcp-clients");
    await deleteMcpClient("row1");
    expect(db.mcpToken.deleteMany).toHaveBeenCalledWith({
      where: { clientId: "kmc_abc" },
    });
    expect(db.mcpAuthorizationCode.deleteMany).toHaveBeenCalledWith({
      where: { clientId: "kmc_abc" },
    });
    expect(db.mcpClient.delete).toHaveBeenCalledWith({ where: { id: "row1" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("listMcpClients counts connections per client", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpClient.findMany).mockResolvedValue([
      {
        id: "row1",
        clientId: "kmc_abc",
        name: "Grok Bot",
        redirectUris: ["https://a.example/cb"],
        createdAt: new Date("2026-09-04T00:00:00Z"),
        createdBy: "admin1",
      },
    ] as never);
    vi.mocked(db.mcpToken.groupBy).mockResolvedValue([
      { clientId: "kmc_abc", _count: { _all: 2 } },
    ] as never);
    const { listMcpClients } = await import("@/actions/mcp-clients");
    expect(await listMcpClients()).toEqual([
      {
        id: "row1",
        clientId: "kmc_abc",
        name: "Grok Bot",
        redirectUris: ["https://a.example/cb"],
        createdAt: "2026-09-04T00:00:00.000Z",
        connectionCount: 2,
      },
    ]);
  });
});
