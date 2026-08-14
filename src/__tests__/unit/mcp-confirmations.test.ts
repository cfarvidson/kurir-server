import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mcpConfirmation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

describe("mcp confirmations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createConfirmation persists args hash and 10-minute TTL", async () => {
    const { db } = await import("@/lib/db");
    const { hashArgs } = await import("@/lib/mcp/canonical-json");
    vi.mocked(db.mcpConfirmation.create).mockResolvedValue({} as never);
    const { createConfirmation } = await import("@/lib/mcp/confirmations");
    const args = { to: ["a@b.c"], subject: "Hi" };
    const before = Date.now();
    const result = await createConfirmation({
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      args,
    });
    const after = Date.now();

    expect(result.id).toEqual(expect.any(String));
    expect(result.id.length).toBeGreaterThan(10);
    expect(result.message).toEqual(expect.any(String));
    expect(result.message.length).toBeGreaterThan(0);

    const data = vi.mocked(db.mcpConfirmation.create).mock.calls[0][0].data as {
      id: string;
      userId: string;
      tokenId: string;
      toolName: string;
      argsHash: string;
      argsJson: unknown;
      expiresAt: Date;
    };
    expect(data.id).toBe(result.id);
    expect(data.userId).toBe("u1");
    expect(data.tokenId).toBe("t1");
    expect(data.toolName).toBe("send_mail");
    expect(data.argsHash).toBe(hashArgs(args));
    expect(data.argsJson).toEqual(args);
    const ttlMs = data.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000 + (after - before) + 1000);
  });

  it("accept is single-use and hash-bound", async () => {
    const { db } = await import("@/lib/db");
    const { hashArgs } = await import("@/lib/mcp/canonical-json");
    const args = { to: ["a@b.c"], subject: "Hi" };
    vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
      id: "h1",
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      argsHash: hashArgs(args),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 1 });
    const { consumeConfirmation } = await import("@/lib/mcp/confirmations");
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args,
        action: "accept",
      }),
    ).toBe("accept");
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args: { to: ["evil@b.c"], subject: "Hi" },
        action: "accept",
      }),
    ).toBe("mismatch");

    // Second accept on the same handle loses the race / is already consumed.
    vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 0 });
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args,
        action: "accept",
      }),
    ).toBe("mismatch");
  });

  it("expired confirmation is mismatch", async () => {
    const { db } = await import("@/lib/db");
    const { hashArgs } = await import("@/lib/mcp/canonical-json");
    const args = { to: ["a@b.c"] };
    vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
      id: "h1",
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      argsHash: hashArgs(args),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    } as never);
    const { consumeConfirmation } = await import("@/lib/mcp/confirmations");
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args,
        action: "accept",
      }),
    ).toBe("mismatch");
    expect(db.mcpConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it("deny cancels the confirmation", async () => {
    const { db } = await import("@/lib/db");
    const { hashArgs } = await import("@/lib/mcp/canonical-json");
    const args = { to: ["a@b.c"] };
    vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
      id: "h1",
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      argsHash: hashArgs(args),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 1 });
    const { consumeConfirmation } = await import("@/lib/mcp/confirmations");
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args,
        action: "decline",
      }),
    ).toBe("cancel");
    expect(
      await consumeConfirmation({
        id: "h1",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args,
        action: undefined,
      }),
    ).toBe("cancel");
    expect(db.mcpConfirmation.updateMany).toHaveBeenCalled();
  });

  it("missing row is mismatch", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue(null);
    const { consumeConfirmation } = await import("@/lib/mcp/confirmations");
    expect(
      await consumeConfirmation({
        id: "missing",
        userId: "u1",
        tokenId: "t1",
        toolName: "send_mail",
        args: {},
        action: "accept",
      }),
    ).toBe("mismatch");
    expect(db.mcpConfirmation.updateMany).not.toHaveBeenCalled();
  });
});
