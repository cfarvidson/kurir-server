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

// Network (kurir-ios#117) has its own module and tests.
const loadPersonNetwork = vi.fn(async (..._args: unknown[]) => [
  { email: "bea@x.y", displayName: "Bea", kind: "sharedThread", strength: 1, sharedThreads: 1 },
]);
vi.mock("@/lib/mail/person-network", () => ({
  loadPersonNetwork: (...args: unknown[]) => loadPersonNetwork(...args),
}));
vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn(async () => ({ emails: ["me@z"], domains: [] })),
}));
vi.mock("@/lib/mail/person-links", () => ({
  loadPersonLinks: vi.fn(async () => []),
}));
vi.mock("@/lib/mail/person-appointments", () => ({
  appointmentsForPerson: vi.fn(async () => []),
}));
vi.mock("@/lib/mail/person-schedule", () => ({
  loadScheduleInstances: vi.fn(async () => []),
  scheduleDraft: vi.fn(() => ({
    to: "ada@x.y",
    subject: "Time to meet?",
    body: "My week is packed. When works for you?",
  })),
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

  /** Conversation rows for the thread query, `judged` for the AI verdict query. */
  async function mockMessages(rows: unknown[], judged: unknown[] = []) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockImplementation(((args: {
      where: { contentRuleMatches?: unknown };
    }) =>
      Promise.resolve(
        args.where.contentRuleMatches ? judged : rows,
      )) as never);
  }

  async function seed() {
    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.message.aggregate).mockResolvedValue({
      _min: { receivedAt: null },
      _max: { receivedAt: null },
    } as never);
    await mockMessages([
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
        fromAddress: "ada@x.y",
        toAddresses: ["me@z"],
        ccAddresses: [],
        sender: null,
      },
    ]);
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

  it("carries the person's Network, loaded with the user's own addresses", async () => {
    await seed();
    const context = await getContactContext("user-1", "ada@x.y");
    expect(loadPersonNetwork).toHaveBeenCalledWith("user-1", "ada@x.y", {
      emails: ["me@z"],
      domains: [],
    });
    expect(context.network.map((n) => n.email)).toEqual(["bea@x.y"]);
  });

  it("queries without a text filter when q is omitted", async () => {
    const db = await seed();
    await getContactContext("user-1", "ada@x.y");
    const args = vi.mocked(db.message.findMany).mock.calls[0][0]!;
    expect(args.where).not.toHaveProperty("AND");
  });

  it("caps the collapsed threads at the pane limit", async () => {
    const db = await seed();
    await mockMessages(
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
        fromAddress: "ada@x.y",
        toAddresses: ["me@z"],
        ccAddresses: [],
        sender: null,
      })),
    );
    const context = await getContactContext("user-1", "ada@x.y");
    expect(context.recentThreads).toHaveLength(CONTACT_CONTEXT_THREAD_LIMIT);
    const args = vi.mocked(db.message.findMany).mock.calls[0][0]!;
    expect(args.take).toBeGreaterThanOrEqual(50);
  });

  it("carries the newest AI verdicts on the person's mail, a match over misses", async () => {
    const db = await seed();
    const rows = (await db.message.findMany({ where: {} } as never)) as unknown[];
    await mockMessages(rows, [
      {
        id: "m1",
        subject: "Uppdrag i Uppsala",
        receivedAt: new Date("2026-01-03"),
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        contentRuleMatches: [
          { matched: false, reason: "No", appliedAction: "KEEP", rule: { criterion: "b" } },
          { matched: true, reason: " Remote ", appliedAction: "IMBOX", rule: { criterion: "a" } },
        ],
      },
    ]);
    const context = await getContactContext("user-1", "ada@x.y");
    expect(context.aiVerdicts).toEqual([
      expect.objectContaining({
        id: "m1",
        matched: true,
        appliedAction: "IMBOX",
        reason: "Remote",
        criterion: "a",
      }),
    ]);
  });

  it("skips the link scan for a Feed sender", async () => {
    const db = await seed();
    const { loadPersonLinks } = await import("@/lib/mail/person-links");
    vi.mocked(db.sender.findFirst).mockResolvedValue({
      category: "FEED",
    } as never);
    const context = await getContactContext("u1", "news@x.y");
    expect(loadPersonLinks).not.toHaveBeenCalled();
    expect(context.links).toEqual([]);
  });
});
