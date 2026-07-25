/**
 * Integration tests for GET /api/mobile/files — the mobile file browser over
 * the shared getFiles() query. Covers auth, per-user scoping + newest-first
 * ordering, cursor pagination (no overlap), the type-group and filename
 * filters, response field mapping, and group validation. The db is mocked so
 * getFiles' real where/orderBy/cursor logic runs against controllable rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    attachment: { findMany: vi.fn() },
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
  } as never;
}

function makeRow(i: number) {
  return {
    id: `c${"a".repeat(24)}${i}`,
    filename: `file-${i}.pdf`,
    contentType: "application/pdf",
    size: 1000,
    createdAt: new Date(2026, 0, i + 1),
    message: {
      id: `m${i}`,
      subject: `Subject ${i}`,
      receivedAt: new Date(2026, 0, i + 1),
      fromName: "Alice",
      fromAddress: "alice@example.com",
    },
  };
}

async function mockAuthed(userId = "user-1") {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId });
}

describe("GET /api/mobile/files", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(a) returns 401 without valid bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/mobile/files/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("(b) scopes to the user's own attachments, newest first, and maps fields", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      makeRow(1),
      makeRow(0),
    ] as never);

    const { GET } = await import("@/app/api/mobile/files/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({
      message: { is: { userId: "user-1" } },
    });
    expect(arg?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

    const body = await res.json();
    expect(body.files).toEqual([
      {
        id: `c${"a".repeat(24)}1`,
        filename: "file-1.pdf",
        contentType: "application/pdf",
        size: 1000,
        createdAt: new Date(2026, 0, 2).toISOString(),
        messageId: "m1",
        messageSubject: "Subject 1",
        fromAddress: "alice@example.com",
      },
      {
        id: `c${"a".repeat(24)}0`,
        filename: "file-0.pdf",
        contentType: "application/pdf",
        size: 1000,
        createdAt: new Date(2026, 0, 1).toISOString(),
        messageId: "m0",
        messageSubject: "Subject 0",
        fromAddress: "alice@example.com",
      },
    ]);
  });

  it("(c) a full page yields a cursor whose next request excludes the prior page", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");

    // First page: a full page (limit 2) → hasMore + nextCursor.
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      makeRow(2),
      makeRow(1),
    ] as never);

    const { GET } = await import("@/app/api/mobile/files/route");
    const first = await GET(makeRequest({ limit: "2" }));
    const firstBody = await first.json();
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toBeTruthy();

    // Second page: pass the cursor back. The where must carry a strictly-less
    // condition so the next page cannot repeat the boundary row.
    vi.mocked(db.attachment.findMany).mockResolvedValue([makeRow(0)] as never);
    const second = await GET(
      makeRequest({ limit: "2", cursor: firstBody.nextCursor }),
    );
    const secondBody = await second.json();

    const arg = vi.mocked(db.attachment.findMany).mock.calls[1][0];
    expect(JSON.stringify(arg?.where)).toContain('"lt"');
    // Partial page → no more.
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextCursor).toBeNull();
    expect(secondBody.files.map((f: { id: string }) => f.id)).toEqual([
      `c${"a".repeat(24)}0`,
    ]);
  });

  it("(d) group=image filters on the image/ content-type prefix", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/mobile/files/route");
    const res = await GET(makeRequest({ group: "image" }));
    expect(res.status).toBe(200);

    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(JSON.stringify(arg?.where)).toContain("image/");
  });

  it("(e) q filters on the filename, case-insensitively", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);

    const { GET } = await import("@/app/api/mobile/files/route");
    const res = await GET(makeRequest({ q: "invoice" }));
    expect(res.status).toBe(200);

    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(arg?.where?.filename).toMatchObject({
      contains: "invoice",
      mode: "insensitive",
    });
  });

  it("(f) an unknown group is a 400 and never hits the db", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");

    const { GET } = await import("@/app/api/mobile/files/route");
    const res = await GET(makeRequest({ group: "spreadsheets" }));
    expect(res.status).toBe(400);
    expect(db.attachment.findMany).not.toHaveBeenCalled();
  });
});
