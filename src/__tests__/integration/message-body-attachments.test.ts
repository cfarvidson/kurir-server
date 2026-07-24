/**
 * Integration tests for GET /api/mail/message/[id]/body — attachment
 * metadata in the response (consumed by the iOS client and the screener
 * preview).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/mobile/auth", () => ({
  getRequestUserId: vi.fn(),
}));

function makeRequest() {
  return { headers: { get: () => null } } as any;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function mockAuthed() {
  const { getRequestUserId } = await import("@/lib/mobile/auth");
  vi.mocked(getRequestUserId).mockResolvedValue("user-1");
}

describe("GET /api/mail/message/[id]/body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const { getRequestUserId } = await import("@/lib/mobile/auth");
    vi.mocked(getRequestUserId).mockResolvedValue(null);

    const { GET } = await import("@/app/api/mail/message/[id]/body/route");
    const res = await GET(makeRequest(), makeParams("m1"));
    expect(res.status).toBe(401);
  });

  it("includes attachment metadata alongside the body", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findUnique).mockResolvedValue({
      htmlBody: "<p>hi</p>",
      textBody: "hi",
      userId: "user-1",
      attachments: [
        {
          id: "att-1",
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 12345,
        },
      ],
    } as any);

    const { GET } = await import("@/app/api/mail/message/[id]/body/route");
    const res = await GET(makeRequest(), makeParams("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.html).toBe("<p>hi</p>");
    expect(body.attachments).toEqual([
      {
        id: "att-1",
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 12345,
      },
    ]);
    expect(db.message.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          attachments: {
            select: {
              id: true,
              filename: true,
              contentType: true,
              size: true,
            },
          },
        }),
      }),
    );
  });

  it("returns an empty attachments array when the message has none", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findUnique).mockResolvedValue({
      htmlBody: null,
      textBody: "plain",
      userId: "user-1",
      attachments: [],
    } as any);

    const { GET } = await import("@/app/api/mail/message/[id]/body/route");
    const res = await GET(makeRequest(), makeParams("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachments).toEqual([]);
  });

  it("returns 403 for another user's message", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findUnique).mockResolvedValue({
      htmlBody: null,
      textBody: null,
      userId: "someone-else",
      attachments: [],
    } as any);

    const { GET } = await import("@/app/api/mail/message/[id]/body/route");
    const res = await GET(makeRequest(), makeParams("m1"));
    expect(res.status).toBe(403);
  });
});
