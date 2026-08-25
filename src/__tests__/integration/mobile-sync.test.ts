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
    user: { findUnique: vi.fn() },
    domainRule: { findMany: vi.fn().mockResolvedValue([]) },
    subjectRule: { findMany: vi.fn().mockResolvedValue([]) },
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
  vi.mocked(db.user.findUnique).mockResolvedValue(null);
  vi.mocked(db.domainRule.findMany).mockResolvedValue([]);
  vi.mocked(db.subjectRule.findMany).mockResolvedValue([]);
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

  it("returns the user's role, defaulting to USER when unknown", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    await mockEmptyTables();
    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "ADMIN" } as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const admin = await (await GET(makeRequest())).json();
    expect(admin.role).toBe("ADMIN");

    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const fallback = await (await GET(makeRequest())).json();
    expect(fallback.role).toBe("USER");
  });

  it("returns the user's resolved image policy, defaulting to BLOCK_ALL", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    await mockEmptyTables();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      role: "USER",
      blockRemoteImages: false,
      blockTrackers: true,
    } as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const trackers = await (await GET(makeRequest())).json();
    expect(trackers.imagePolicy).toBe("BLOCK_TRACKERS");

    vi.mocked(db.user.findUnique).mockResolvedValue({
      role: "USER",
      blockRemoteImages: false,
      blockTrackers: false,
    } as any);
    const allowAll = await (await GET(makeRequest())).json();
    expect(allowAll.imagePolicy).toBe("ALLOW_ALL");

    // Unknown user (or pre-feature row): safest default.
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const fallback = await (await GET(makeRequest())).json();
    expect(fallback.imagePolicy).toBe("BLOCK_ALL");
  });

  it("selects and returns each sender's allowRemoteImages flag", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.messageTombstone.findMany).mockResolvedValue([]);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([
      {
        id: "s1",
        updatedAt: new Date("2026-07-01T10:00:00Z"),
        email: "a@b.c",
        displayName: null,
        domain: "b.c",
        status: "APPROVED",
        category: "IMBOX",
        skippedUntil: null,
        unthread: false,
        allowRemoteImages: true,
        messageCount: 1,
        emailConnectionId: "conn-1",
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.senders[0].allowRemoteImages).toBe(true);
    // The select must request the column from Prisma.
    const select = vi.mocked(db.sender.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.allowRemoteImages).toBe(true);
  });

  it("returns each connection's sendAsEmail and aliases", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.messageTombstone.findMany).mockResolvedValue([]);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      {
        id: "conn-1",
        email: "me@work.com",
        displayName: "Me",
        isDefault: true,
        sendAsEmail: "me@personal.com",
        aliases: ["alias1@work.com", "alias2@work.com"],
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.connections[0].sendAsEmail).toBe("me@personal.com");
    expect(body.connections[0].aliases).toEqual([
      "alias1@work.com",
      "alias2@work.com",
    ]);
    // The select must request the alias columns from Prisma.
    const select = vi.mocked(db.emailConnection.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.sendAsEmail).toBe(true);
    expect(select.aliases).toBe(true);
  });

  it("accepts the sender-advanced cursor it emits (empty id)", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const senderAt = new Date("2026-07-27T10:00:00Z");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "s1", updatedAt: senderAt },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const first = await GET(makeRequest());
    const body = await first.json();
    // Message stream drained → cursor advanced to the newest sender, no id.
    expect(body.nextCursor).toBe(`${senderAt.toISOString()}_`);

    // The client stores that cursor and sends it back on the next sync.
    const second = await GET(makeRequest({ cursor: body.nextCursor }));
    expect(second.status).toBe(200);
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

  it("flattens folder.specialUse into a flat folderRole", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");

    const t1 = new Date("2026-07-01T10:00:00Z");
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "a", updatedAt: t1, folder: { specialUse: "sent" } },
      { id: "b", updatedAt: t1, folder: { specialUse: null } },
      { id: "c", updatedAt: t1, folder: null },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.messages.map((m: { folderRole: string | null }) => m.folderRole))
      .toEqual(["sent", null, null]);
    for (const m of body.messages) {
      expect("folder" in m).toBe(false);
    }
    // The select must ask Prisma for the nested folder role
    const select = vi.mocked(db.message.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.folder).toEqual({ select: { specialUse: true } });
  });

  it("includes meeting on a message that has a MessageMeeting row and omits it otherwise", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");

    const t1 = new Date("2026-07-01T10:00:00Z");
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "with-meeting",
        updatedAt: t1,
        folder: null,
        meeting: {
          uid: "uid-standup",
          method: "REQUEST",
          title: "Standup",
          startAt: new Date("2026-08-20T09:00:00.000Z"),
          endAt: new Date("2026-08-20T09:30:00.000Z"),
          isAllDay: false,
          location: "Zoom",
          organizerName: "Ada",
          organizerEmail: "ada@x.y",
          calendarEventId: "evt-1",
          calendarEvent: {
            attendeesJson: [
              { email: "ada@x.y", partstat: "ACCEPTED" },
              { email: "me@x.y", partstat: "DECLINED", self: true },
            ],
          },
        },
      },
      {
        id: "no-meeting",
        updatedAt: t1,
        folder: null,
        meeting: null,
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.messages[0].meeting).toEqual({
      uid: "uid-standup",
      method: "REQUEST",
      title: "Standup",
      startAt: "2026-08-20T09:00:00.000Z",
      endAt: "2026-08-20T09:30:00.000Z",
      isAllDay: false,
      location: "Zoom",
      organizerName: "Ada",
      organizerEmail: "ada@x.y",
      calendarEventId: "evt-1",
      response: "declined",
    });
    expect("meeting" in body.messages[1]).toBe(false);

    const select = vi.mocked(db.message.findMany).mock.calls[0][0]!
      .select as any;
    expect(select.meeting).toEqual({
      select: {
        uid: true,
        method: true,
        title: true,
        startAt: true,
        endAt: true,
        isAllDay: true,
        location: true,
        organizerName: true,
        organizerEmail: true,
        calendarEventId: true,
        calendarEvent: { select: { attendeesJson: true } },
      },
    });
  });

  it("returns the full domain-rule set on every sync (replace-all)", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([
      {
        id: "r1",
        pattern: "github.com",
        includeSubdomains: true,
        status: "APPROVED",
        category: "PAPER_TRAIL",
        emailConnectionId: "conn-1",
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    // Rules are not cursor-filtered — a caught-up cursor still gets them all.
    const res = await GET(
      makeRequest({ cursor: "2026-07-01T10:00:00.000Z_b" }),
    );
    const body = await res.json();

    expect(body.domainRules).toEqual([
      {
        id: "r1",
        pattern: "github.com",
        includeSubdomains: true,
        status: "APPROVED",
        category: "PAPER_TRAIL",
        emailConnectionId: "conn-1",
      },
    ]);
    const arg = vi.mocked(db.domainRule.findMany).mock.calls[0][0] as any;
    expect(arg.where).toEqual({ userId: "user-1" });
  });

  it("returns the full subject-rule set on every sync (replace-all)", async () => {
    await mockAuthed();
    await mockEmptyTables();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.subjectRule.findMany).mockResolvedValue([
      {
        id: "sr1",
        scope: "ADDRESS",
        scopeValue: "news@github.com",
        pattern: "security digest",
        status: "APPROVED",
        category: "FEED",
        emailConnectionId: "conn-1",
      },
    ] as any);

    const { GET } = await import("@/app/api/mobile/sync/route");
    // Rules are not cursor-filtered — a caught-up cursor still gets them all.
    const res = await GET(
      makeRequest({ cursor: "2026-07-01T10:00:00.000Z_b" }),
    );
    const body = await res.json();

    expect(body.subjectRules).toEqual([
      {
        id: "sr1",
        scope: "ADDRESS",
        scopeValue: "news@github.com",
        pattern: "security digest",
        status: "APPROVED",
        category: "FEED",
        emailConnectionId: "conn-1",
      },
    ]);
    const arg = vi.mocked(db.subjectRule.findMany).mock.calls[0][0] as any;
    expect(arg.where).toEqual({ userId: "user-1" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
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
