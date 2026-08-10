/**
 * Integration tests for /api/mobile/drafts — the mobile CRUD surface over the
 * shared draft cores. Auth, the shared zod schema, the upsert key, attachment
 * ownership, per-user list scoping, and delete idempotency. The db is mocked so
 * the cores' real ownership/upsert-key logic runs against controllable data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    draft: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    attachment: {
      count: vi.fn(),
    },
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

function makeRequest(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

async function mockAuthed(userId = "user-1") {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId });
}

async function mockUnauthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue(null);
}

describe("/api/mobile/drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) PUT without bearer auth returns 401", async () => {
    await mockUnauthed();
    const { PUT } = await import("@/app/api/mobile/drafts/route");
    const res = await PUT(
      makeRequest({ type: "NEW", contextMessageId: "__new__", body: "hi" }),
    );
    expect(res.status).toBe(401);
  });

  it("(b) PUT upserts on the (userId, type, contextMessageId) key; a second PUT with the same key overwrites", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.draft.upsert).mockResolvedValue({ id: "d1" } as never);

    const { PUT } = await import("@/app/api/mobile/drafts/route");

    await PUT(
      makeRequest({
        type: "REPLY",
        contextMessageId: "msg-42",
        to: "a@x.com",
        subject: "Hi",
        body: "first",
      }),
    );
    await PUT(
      makeRequest({
        type: "REPLY",
        contextMessageId: "msg-42",
        to: "a@x.com",
        subject: "Hi",
        body: "second",
      }),
    );

    expect(db.draft.upsert).toHaveBeenCalledTimes(2);
    // Both calls target the identical composite key — Prisma resolves the
    // second to an update (overwrite), not a new row.
    const key = {
      userId_type_contextMessageId: {
        userId: "user-1",
        type: "REPLY",
        contextMessageId: "msg-42",
      },
    };
    expect(vi.mocked(db.draft.upsert).mock.calls[0][0].where).toEqual(key);
    expect(vi.mocked(db.draft.upsert).mock.calls[1][0].where).toEqual(key);
    expect(vi.mocked(db.draft.upsert).mock.calls[1][0].update.body).toBe(
      "second",
    );
  });

  it("(c) GET lists the authed user's drafts (scoped by userId), newest first", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.draft.findMany).mockResolvedValue([
      {
        type: "NEW",
        contextMessageId: "__new__",
        to: "a@x.com",
        subject: "S",
        body: "B",
        emailConnectionId: null,
        attachmentIds: [],
        updatedAt: new Date("2026-07-25T00:00:00.000Z"),
      },
    ] as never);

    const { GET } = await import("@/app/api/mobile/drafts/route");
    const res = await GET({
      headers: { get: () => null },
    } as any);

    expect(res.status).toBe(200);
    // Scoped to the authed user only — other users' drafts never queried.
    expect(db.draft.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { updatedAt: "desc" },
    });
    const body = await res.json();
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0].contextMessageId).toBe("__new__");
  });

  it("(d) DELETE removes by key and is idempotent (second DELETE still 200)", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.draft.deleteMany).mockResolvedValue({ count: 1 } as never);

    const { DELETE } = await import("@/app/api/mobile/drafts/route");

    const first = await DELETE(
      makeRequest({ type: "NEW", contextMessageId: "__new__" }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true });
    expect(db.draft.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", type: "NEW", contextMessageId: "__new__" },
    });

    vi.mocked(db.draft.deleteMany).mockResolvedValue({ count: 0 } as never);
    const second = await DELETE(
      makeRequest({ type: "NEW", contextMessageId: "__new__" }),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ success: true });
  });

  it("(e) PUT referencing another user's attachment returns 400", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    // Only 0 of the 1 referenced attachments belong to this user.
    vi.mocked(db.attachment.count).mockResolvedValue(0 as never);

    const { PUT } = await import("@/app/api/mobile/drafts/route");
    const res = await PUT(
      makeRequest({
        type: "NEW",
        contextMessageId: "__new__",
        body: "hi",
        attachmentIds: ["not-mine"],
      }),
    );

    expect(res.status).toBe(400);
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("PUT with a malformed body returns 400", async () => {
    await mockAuthed();
    const { PUT } = await import("@/app/api/mobile/drafts/route");
    const res = await PUT(makeRequest({ type: "NOT_A_TYPE" }));
    expect(res.status).toBe(400);
  });

  it("(f) two NEW drafts with different client UUIDs upsert under distinct keys", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.draft.upsert).mockResolvedValue({ id: "d1" } as never);

    const { PUT } = await import("@/app/api/mobile/drafts/route");
    await PUT(
      makeRequest({ type: "NEW", contextMessageId: "uuid-aaaa", body: "first" }),
    );
    await PUT(
      makeRequest({ type: "NEW", contextMessageId: "uuid-bbbb", body: "second" }),
    );

    // Distinct context ids -> distinct upsert keys -> two coexisting drafts.
    const keys = vi
      .mocked(db.draft.upsert)
      .mock.calls.map(
        (c) => c[0].where.userId_type_contextMessageId.contextMessageId,
      );
    expect(keys).toEqual(["uuid-aaaa", "uuid-bbbb"]);
  });
});
