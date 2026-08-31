import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sender: { findFirst: vi.fn() },
    message: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}));

// Signature details + stats (kurir-ios#116) come from their own module.
vi.mock("@/lib/mail/person-profile", () => ({
  getPersonProfile: vi.fn(async () => null),
}));

vi.mock("@/lib/mail/threads", () => ({
  collapseToThreads: vi.fn((messages: unknown[]) => messages),
  getThreadCounts: vi.fn(async () => new Map()),
}));

import {
  CONTACT_CONTEXT_THREAD_LIMIT,
  contactConversationWhere,
  getContactContext,
} from "@/lib/mail/contact-context";

describe("contactConversationWhere", () => {
  it("matches mail from or to the person across every list, Archive included", () => {
    const where = contactConversationWhere("user-1", "ada@x.y");
    expect(where).toEqual({
      userId: "user-1",
      OR: [{ fromAddress: "ada@x.y" }, { toAddresses: { has: "ada@x.y" } }],
    });
    expect(JSON.stringify(where)).not.toContain("isArchived");
  });

  it("adds a case-insensitive subject/snippet filter for q", () => {
    const where = contactConversationWhere("user-1", "ada@x.y", "  budget ");
    expect(where.AND).toEqual({
      OR: [
        { subject: { contains: "budget", mode: "insensitive" } },
        { snippet: { contains: "budget", mode: "insensitive" } },
      ],
    });
    // The person constraint stays in place; q only narrows within it.
    expect(where.OR).toEqual([
      { fromAddress: "ada@x.y" },
      { toAddresses: { has: "ada@x.y" } },
    ]);
  });

  it("treats blank or missing q as the full history", () => {
    expect(contactConversationWhere("u", "a@x.y", "   ").AND).toBeUndefined();
    expect(contactConversationWhere("u", "a@x.y", null).AND).toBeUndefined();
    expect(contactConversationWhere("u", "a@x.y").AND).toBeUndefined();
  });
});

describe("getContactContext", () => {
  beforeEach(() => vi.clearAllMocks());

  async function seed() {
    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.message.aggregate).mockResolvedValue({
      _min: { receivedAt: null },
      _max: { receivedAt: null },
    } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "arch",
        subject: "Budget follow-up",
        receivedAt: new Date("2026-01-02"),
        threadId: "t-arch",
        isRead: true,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: true,
        hasAttachments: false,
        sender: null,
      },
    ] as never);
    return db;
  }

  it("passes q through to the conversation query and keeps archived hits", async () => {
    const db = await seed();
    const context = await getContactContext("user-1", "ada@x.y", {
      q: "budget",
    });
    const args = vi.mocked(db.message.findMany).mock.calls[0][0]!;
    expect(args.where).toEqual(
      contactConversationWhere("user-1", "ada@x.y", "budget"),
    );
    // collapseToThreads is mocked as identity, so ids are message ids here.
    expect(context.recentThreads.map((t) => t.id)).toEqual(["arch"]);
    expect(context.recentThreads[0].isArchived).toBe(true);
  });

  it("queries without a text filter when q is omitted", async () => {
    const db = await seed();
    await getContactContext("user-1", "ada@x.y");
    const args = vi.mocked(db.message.findMany).mock.calls[0][0]!;
    expect(args.where).not.toHaveProperty("AND");
  });

  it("caps the collapsed threads at the pane limit", async () => {
    const db = await seed();
    vi.mocked(db.message.findMany).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        subject: `s${i}`,
        receivedAt: new Date(2026, 0, 12 - i),
        threadId: `t${i}`,
        isRead: true,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        hasAttachments: false,
        sender: null,
      })) as never,
    );
    const context = await getContactContext("user-1", "ada@x.y");
    expect(context.recentThreads).toHaveLength(CONTACT_CONTEXT_THREAD_LIMIT);
    const args = vi.mocked(db.message.findMany).mock.calls[0][0]!;
    expect(args.take).toBeGreaterThanOrEqual(50);
  });
});
