/**
 * Integration tests for GET /api/mobile/sync — delta-sync cursor semantics,
 * pagination, tombstones, and auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
    sender: { findMany: vi.fn() },
    messageTombstone: { findMany: vi.fn() },
    emailConnection: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
  };
});

function makeRequest(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  return {
    headers: { get: () => null },
    nextUrl: { searchParams },
  } as any;
}

function makeMessage(id: string, updatedAt: Date) {
  return { id, updatedAt, subject: `msg ${id}` };
}

async function mockAuthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "user-1" });
}

async function mockEmptyTables() {
  const { db } = await import("@/lib/db");
  vi.mocked(db.sender.findMany).mockResolvedValue([]);
  vi.mocked(db.messageTombstone.findMany).mockResolvedValue([]);
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([]);
}

describe("GET /api/mobile/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without valid bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed cursor", async () => {
    await mockAuthed();

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest({ cursor: "not-a-cursor" }));
    expect(res.status).toBe(400);
  });

  it("pages messages and reports hasMore with a compound cursor", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");

    const t1 = new Date("2026-07-01T10:00:00Z");
    const t2 = new Date("2026-07-01T11:00:00Z");
    // limit=2 → route asks for 3; return 3 to signal one more page
    vi.mocked(db.message.findMany).mockResolvedValue([
      makeMessage("a", t1),
      makeMessage("b", t1),
      makeMessage("c", t2),
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest({ limit: "2" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.messages).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    // Cursor points at the last *returned* message (b), not the peeked one
    expect(body.nextCursor).toBe(`${t1.toISOString()}_b`);
  });

  it("passes a compound (updatedAt, id) filter for the cursor", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const cursorAt = "2026-07-01T10:00:00.000Z";
    const { GET } = await import("@/app/api/mobile/sync/route");
    await GET(makeRequest({ cursor: `${cursorAt}_b` }));

    const where = vi.mocked(db.message.findMany).mock.calls[0][0]!.where as any;
    expect(where.userId).toBe("user-1");
    expect(where.OR).toEqual([
      { updatedAt: { gt: new Date(cursorAt) } },
      { updatedAt: new Date(cursorAt), id: { gt: "b" } },
    ]);
  });

  it("includes tombstones and active connections", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.messageTombstone.findMany).mockResolvedValue([
      { messageId: "gone-1" },
      { messageId: "gone-2" },
    ] as any);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "a@b.c", displayName: null, isDefault: true },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.deletedMessageIds).toEqual(["gone-1", "gone-2"]);
    expect(body.connections).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it("keeps the incoming cursor when nothing changed", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const cursor = "2026-07-01T10:00:00.000Z_b";
    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest({ cursor }));
    const body = await res.json();

    expect(body.nextCursor).toBe(cursor);
    expect(body.hasMore).toBe(false);
  });

  it("never returns message bodies", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const { GET } = await import("@/app/api/mobile/sync/route");
    await GET(makeRequest());

    const select = vi.mocked(db.message.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.htmlBody).toBeUndefined();
    expect(select.textBody).toBeUndefined();
    expect(select.search_vector).toBeUndefined();
  });
});
