/**
 * Integration tests for GET /api/mobile/search — auth, query validation,
 * FTS delegation, and rank-order preservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
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

vi.mock("@/lib/mail/search", () => ({
  searchMessages: vi.fn(),
}));

function makeRequest(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  return {
    headers: { get: () => null },
    nextUrl: { searchParams },
  } as any;
}

async function mockAuthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "user-1" });
}

describe("GET /api/mobile/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without valid bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "hello" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing or blank query", async () => {
    await mockAuthed();
    const { GET } = await import("@/app/api/mobile/search/route");

    expect((await GET(makeRequest())).status).toBe(400);
    expect((await GET(makeRequest({ q: "   " }))).status).toBe(400);
  });

  it("delegates to searchMessages with the user id and clamped limit", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    vi.mocked(searchMessages).mockResolvedValue([]);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "invoice", limit: "9999" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      expect.anything(),
      50,
    );
  });

  it("returns full metadata in FTS rank order", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { db } = await import("@/lib/db");

    // FTS ranks m2 above m1; findMany returns rows in arbitrary order.
    vi.mocked(searchMessages).mockResolvedValue([
      { id: "m2" },
      { id: "m1" },
    ] as any);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", subject: "first" },
      { id: "m2", subject: "second" },
    ] as any);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "hello" }));

    const body = await res.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([
      "m2",
      "m1",
    ]);
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", id: { in: ["m2", "m1"] } },
      }),
    );
  });

  it("drops ids the metadata fetch no longer finds", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { db } = await import("@/lib/db");

    vi.mocked(searchMessages).mockResolvedValue([
      { id: "gone" },
      { id: "m1" },
    ] as any);
    vi.mocked(db.message.findMany).mockResolvedValue([{ id: "m1" }] as any);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "hello" }));

    const body = await res.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["m1"]);
  });
});
