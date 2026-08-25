/**
 * Behavioral tests for the domain-rule mutation cores (plan 033) in
 * src/lib/mail/mutations.ts: create with retroactive sweep, category change,
 * and delete. Mocked Prisma client — no cache layer, no IMAP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
  sender: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  folder: { findFirst: vi.fn() },
  message: { findMany: vi.fn(), updateMany: vi.fn() },
  domainRule: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  $transaction: vi.fn(async (ops: unknown) => ops),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/mail/archive-imap", () => ({
  moveToArchiveViaImap: vi.fn(),
  moveToInboxViaImap: vi.fn(),
}));
vi.mock("@/lib/mail/contacts", () => ({ findOrCreateContactForEmail: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(async (ops: unknown) => ops);
});

function mockSourceSender(
  domain = "news.github.com",
  status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING",
  category: string | null = null,
) {
  // First findUnique resolves the source sender; later calls (from the
  // approve/reject cores during the sweep) just need a matching userId.
  dbMock.sender.findUnique.mockResolvedValue({
    userId: USER,
    domain,
    emailConnectionId: "c1",
    email: "a@" + domain,
    displayName: null,
    status,
    category,
  });
}

describe("createDomainRuleForUser", () => {
  it("upserts the rule and sweeps only matching PENDING senders", async () => {
    mockSourceSender();
    dbMock.domainRule.upsert.mockResolvedValue({
      id: "r1",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });
    dbMock.sender.findMany.mockResolvedValue([
      { id: "p1", domain: "news.github.com" },
      { id: "p2", domain: "unrelated.com" },
    ]);
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await createDomainRuleForUser(USER, {
      senderId: "s1",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });

    expect(dbMock.domainRule.upsert).toHaveBeenCalledWith({
      where: {
        emailConnectionId_pattern_includeSubdomains: {
          emailConnectionId: "c1",
          pattern: "github.com",
          includeSubdomains: true,
        },
      },
      create: {
        userId: USER,
        emailConnectionId: "c1",
        pattern: "github.com",
        includeSubdomains: true,
        status: "APPROVED",
        category: "PAPER_TRAIL",
      },
      update: { status: "APPROVED", category: "PAPER_TRAIL" },
    });

    // Sweep queries PENDING senders on the connection only
    expect(dbMock.sender.findMany).toHaveBeenCalledWith({
      where: { emailConnectionId: "c1", status: "PENDING" },
      select: { id: true, domain: true },
    });

    // Only the matching pending sender is approved (existing core logic)
    expect(dbMock.sender.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          status: "APPROVED",
          category: "PAPER_TRAIL",
        }),
      }),
    );
    const updatedIds = dbMock.sender.update.mock.calls.map(
      (c) => c[0].where.id,
    );
    expect(updatedIds).not.toContain("p2");

    // Provenance stamped on the swept senders
    expect(dbMock.sender.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { decidedByRuleId: "r1" },
    });
  });

  it("sweeps matching senders through the reject core for REJECTED rules", async () => {
    mockSourceSender("spam.example");
    dbMock.domainRule.upsert.mockResolvedValue({
      id: "r2",
      pattern: "spam.example",
      includeSubdomains: false,
      status: "REJECTED",
      category: null,
    });
    dbMock.sender.findMany.mockResolvedValue([
      { id: "p1", domain: "spam.example" },
    ]);
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.folder.findFirst.mockResolvedValue(null);
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await createDomainRuleForUser(USER, {
      senderId: "s1",
      pattern: "spam.example",
      includeSubdomains: false,
      status: "REJECTED",
    });

    expect(dbMock.sender.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
    expect(dbMock.sender.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { decidedByRuleId: "r2" },
    });
  });

  it("moves an already-decided origin sender with the rule (plan 034)", async () => {
    mockSourceSender("news.github.com", "APPROVED", "IMBOX");
    dbMock.domainRule.upsert.mockResolvedValue({
      id: "r3",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });
    dbMock.sender.findMany.mockResolvedValue([]);
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await createDomainRuleForUser(USER, {
      senderId: "s1",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });

    // Origin re-approved into the rule's category…
    expect(dbMock.sender.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({
          status: "APPROVED",
          category: "PAPER_TRAIL",
        }),
      }),
    );
    // …and stamped with provenance.
    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { decidedByRuleId: "r3" },
    });
  });

  it("screens out an already-approved origin sender for REJECTED rules", async () => {
    mockSourceSender("spam.example", "APPROVED", "IMBOX");
    dbMock.domainRule.upsert.mockResolvedValue({
      id: "r4",
      pattern: "spam.example",
      includeSubdomains: false,
      status: "REJECTED",
      category: null,
    });
    dbMock.sender.findMany.mockResolvedValue([]);
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.folder.findFirst.mockResolvedValue(null);
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await createDomainRuleForUser(USER, {
      senderId: "s1",
      pattern: "spam.example",
      includeSubdomains: false,
      status: "REJECTED",
    });

    expect(dbMock.sender.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { decidedByRuleId: "r4" },
    });
  });

  it("skips the move when the origin already matches the rule, but still stamps provenance", async () => {
    mockSourceSender("news.github.com", "APPROVED", "PAPER_TRAIL");
    dbMock.domainRule.upsert.mockResolvedValue({
      id: "r5",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });
    dbMock.sender.findMany.mockResolvedValue([]);
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await createDomainRuleForUser(USER, {
      senderId: "s1",
      pattern: "github.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });

    // Only the provenance stamp — no status/category rewrite.
    expect(dbMock.sender.update).toHaveBeenCalledTimes(1);
    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { decidedByRuleId: "r5" },
    });
  });

  it("throws when the pattern does not cover the sender's domain", async () => {
    mockSourceSender("news.github.com");
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createDomainRuleForUser(USER, {
        senderId: "s1",
        pattern: "example.com",
        includeSubdomains: true,
        status: "REJECTED",
      }),
    ).rejects.toThrow("Pattern does not match sender domain");
    expect(dbMock.domainRule.upsert).not.toHaveBeenCalled();
  });

  it("throws for a TLD-only wildcard pattern", async () => {
    mockSourceSender("github.com");
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createDomainRuleForUser(USER, {
        senderId: "s1",
        pattern: "com",
        includeSubdomains: true,
        status: "REJECTED",
      }),
    ).rejects.toThrow("Invalid wildcard pattern");
    expect(dbMock.domainRule.upsert).not.toHaveBeenCalled();
  });

  it("throws when an APPROVED rule is missing a category", async () => {
    mockSourceSender();
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createDomainRuleForUser(USER, {
        senderId: "s1",
        pattern: "github.com",
        includeSubdomains: true,
        status: "APPROVED",
      }),
    ).rejects.toThrow("Category required");
    expect(dbMock.domainRule.upsert).not.toHaveBeenCalled();
  });

  it("throws when the sender belongs to another user", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: "someone-else",
      domain: "github.com",
      emailConnectionId: "c1",
    });
    const { createDomainRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createDomainRuleForUser(USER, {
        senderId: "s1",
        pattern: "github.com",
        includeSubdomains: false,
        status: "REJECTED",
      }),
    ).rejects.toThrow("Sender not found");
  });
});

describe("changeDomainRuleCategoryForUser", () => {
  it("re-categorizes the rule and only its decidedByRuleId senders", async () => {
    dbMock.domainRule.findUnique.mockResolvedValue({
      id: "r1",
      userId: USER,
    });
    const { changeDomainRuleCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );

    await changeDomainRuleCategoryForUser(USER, "r1", "FEED");

    expect(dbMock.domainRule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "APPROVED", category: "FEED" },
    });
    expect(dbMock.sender.updateMany).toHaveBeenCalledWith({
      where: { decidedByRuleId: "r1" },
      data: { status: "APPROVED", category: "FEED" },
    });
    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: {
        sender: { decidedByRuleId: "r1" },
        isArchived: false,
        subjectRuleId: null,
      },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
      },
    });
  });

  it("throws when the rule belongs to another user", async () => {
    dbMock.domainRule.findUnique.mockResolvedValue({
      id: "r1",
      userId: "someone-else",
    });
    const { changeDomainRuleCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );

    await expect(
      changeDomainRuleCategoryForUser(USER, "r1", "FEED"),
    ).rejects.toThrow("Rule not found");
    expect(dbMock.domainRule.update).not.toHaveBeenCalled();
  });
});

describe("deleteDomainRuleForUser", () => {
  it("deletes the rule and nulls provenance while keeping sender decisions", async () => {
    dbMock.domainRule.findUnique.mockResolvedValue({ id: "r1", userId: USER });
    const { deleteDomainRuleForUser } = await import("@/lib/mail/mutations");

    await deleteDomainRuleForUser(USER, "r1");

    expect(dbMock.sender.updateMany).toHaveBeenCalledWith({
      where: { decidedByRuleId: "r1" },
      data: { decidedByRuleId: null },
    });
    // Materialized decisions kept: no status/category writes on senders
    const updateManyData = dbMock.sender.updateMany.mock.calls[0][0].data;
    expect(updateManyData).toEqual({ decidedByRuleId: null });
    expect(dbMock.domainRule.delete).toHaveBeenCalledWith({
      where: { id: "r1" },
    });
  });

  it("is a no-op when the rule is already gone (idempotent replay)", async () => {
    dbMock.domainRule.findUnique.mockResolvedValue(null);
    const { deleteDomainRuleForUser } = await import("@/lib/mail/mutations");

    await deleteDomainRuleForUser(USER, "r1");

    expect(dbMock.domainRule.delete).not.toHaveBeenCalled();
    expect(dbMock.sender.updateMany).not.toHaveBeenCalled();
  });
});
