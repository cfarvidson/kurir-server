/**
 * Integration tests for GET /api/mobile/search — auth, query validation,
 * FTS delegation, and rank-order preservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

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

  /// Search shares MESSAGE_SELECT + presentMobileMessages with sync, but
  /// re-queries separately - pin the meeting response here too so a forked
  /// select can't silently drop it from one endpoint.
  it("carries the meeting's RSVP response like sync does", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { db } = await import("@/lib/db");

    vi.mocked(searchMessages).mockResolvedValue([{ id: "m1" }] as any);
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        folder: null,
        meeting: {
          uid: "uid-standup",
          method: "REQUEST",
          title: "Standup",
          startAt: new Date("2026-08-20T09:00:00.000Z"),
          endAt: new Date("2026-08-20T09:30:00.000Z"),
          isAllDay: false,
          location: null,
          organizerName: null,
          organizerEmail: null,
          calendarEventId: "evt-1",
          calendarEvent: {
            attendeesJson: [
              { email: "me@x.y", partstat: "TENTATIVE", self: true },
            ],
          },
        },
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "standup" }));
    const body = await res.json();

    expect(body.messages[0].meeting.response).toBe("tentative");
    const select = vi.mocked(db.message.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.meeting.select.calendarEvent).toEqual({
      select: { attendeesJson: true },
    });
  });

  it("flattens folder.specialUse into a flat folderRole", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { db } = await import("@/lib/db");

    vi.mocked(searchMessages).mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
    ] as any);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", folder: { specialUse: "sent" } },
      { id: "m2", folder: null },
    ] as any);

    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "hello" }));
    const body = await res.json();

    expect(body.messages.map((m: { folderRole: string | null }) => m.folderRole))
      .toEqual(["sent", null]);
    for (const m of body.messages) {
      expect("folder" in m).toBe(false);
    }
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

  it("passes an empty filter when category is omitted", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    vi.mocked(searchMessages).mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/search/route");
    await GET(makeRequest({ q: "invoice" }));
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      Prisma.empty,
      50,
    );
  });

  it("passes an empty filter when category is an empty string", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    vi.mocked(searchMessages).mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/search/route");
    await GET(makeRequest({ q: "invoice", category: "" }));
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      Prisma.empty,
      50,
    );
  });

  it("applies the list filter when category is a known list", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { searchCategoryFilter } = await import("@/lib/mail/list-contract");
    vi.mocked(searchMessages).mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/search/route");
    await GET(makeRequest({ q: "invoice", category: "feed" }));
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      searchCategoryFilter("feed"),
      50,
    );
  });

  it("returns 400 for an unknown category", async () => {
    await mockAuthed();
    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "invoice", category: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid category" });
  });
});
