/**
 * Behavioral tests for the subject-rule mutation cores (kurir-ios#48/#49) in
 * src/lib/mail/mutations.ts: create with validation + retroactive sweep,
 * category change, and delete. Mocked Prisma client — no cache layer.
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
  subjectRule: {
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

function mockSourceSender(email = "news@github.com") {
  dbMock.sender.findUnique.mockResolvedValue({
    userId: USER,
    email,
    emailConnectionId: "c1",
  });
}

function mockUpsertedRule(overrides: Record<string, unknown> = {}) {
  const rule = {
    id: "srule-1",
    scope: "ADDRESS",
    scopeValue: "news@github.com",
    pattern: "security digest",
    status: "APPROVED",
    category: "FEED",
    emailConnectionId: "c1",
    ...overrides,
  };
  dbMock.subjectRule.upsert.mockResolvedValue(rule);
  return rule;
}

describe("createSubjectRuleForUser", () => {
  it("rejects PENDING status, approve without category, and empty patterns", async () => {
    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createSubjectRuleForUser(USER, {
        senderId: "s1",
        scope: "ADDRESS",
        scopeValue: "a@b.com",
        pattern: "x",
        status: "PENDING",
      }),
    ).rejects.toThrow("Rule status must be APPROVED or REJECTED");

    await expect(
      createSubjectRuleForUser(USER, {
        senderId: "s1",
        scope: "ADDRESS",
        scopeValue: "a@b.com",
        pattern: "x",
        status: "APPROVED",
      }),
    ).rejects.toThrow("Category required");

    await expect(
      createSubjectRuleForUser(USER, {
        senderId: "s1",
        scope: "ADDRESS",
        scopeValue: "a@b.com",
        pattern: "   ",
        status: "REJECTED",
      }),
    ).rejects.toThrow("Subject pattern must not be empty");
  });

  it("rejects a scope that does not cover the origin sender", async () => {
    mockSourceSender("news@github.com");
    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");

    await expect(
      createSubjectRuleForUser(USER, {
        senderId: "s1",
        scope: "DOMAIN",
        scopeValue: "gitlab.com",
        pattern: "x",
        status: "REJECTED",
      }),
    ).rejects.toThrow("Scope does not match sender");
  });

  it("normalizes scopeValue + pattern and upserts on the compound key", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule();
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.message.updateMany.mockResolvedValue({ count: 0 });

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "News@GitHub.com ",
      pattern: "  Security DIGEST ",
      status: "APPROVED",
      category: "FEED",
    });

    expect(dbMock.subjectRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailConnectionId_scope_scopeValue_pattern: {
            emailConnectionId: "c1",
            scope: "ADDRESS",
            scopeValue: "news@github.com",
            pattern: "security digest",
          },
        },
        create: expect.objectContaining({
          scope: "ADDRESS",
          scopeValue: "news@github.com",
          pattern: "security digest",
          status: "APPROVED",
          category: "FEED",
        }),
        update: { status: "APPROVED", category: "FEED" },
      }),
    );
  });

  it("strips the category on screen-out rules", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule({ status: "REJECTED", category: null });
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.message.updateMany.mockResolvedValue({ count: 0 });
    dbMock.folder.findFirst.mockResolvedValue(null);

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "news@github.com",
      pattern: "digest",
      status: "REJECTED",
      category: "FEED",
    });

    expect(dbMock.subjectRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "REJECTED", category: null }),
      }),
    );
  });
});

describe("changeSubjectRuleCategoryForUser", () => {
  it("re-points the rule and moves its non-archived messages", async () => {
    dbMock.subjectRule.findUnique.mockResolvedValue({
      id: "srule-1",
      userId: USER,
    });

    const { changeSubjectRuleCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );
    await changeSubjectRuleCategoryForUser(USER, "srule-1", "PAPER_TRAIL");

    expect(dbMock.subjectRule.update).toHaveBeenCalledWith({
      where: { id: "srule-1" },
      data: { status: "APPROVED", category: "PAPER_TRAIL" },
    });
    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { subjectRuleId: "srule-1", isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: true,
      },
    });
  });

  it("throws for another user's rule", async () => {
    dbMock.subjectRule.findUnique.mockResolvedValue({
      id: "srule-1",
      userId: "someone-else",
    });

    const { changeSubjectRuleCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );
    await expect(
      changeSubjectRuleCategoryForUser(USER, "srule-1", "FEED"),
    ).rejects.toThrow("Rule not found");
  });
});

describe("deleteSubjectRuleForUser", () => {
  it("clears provenance and deletes; placements are kept", async () => {
    dbMock.subjectRule.findUnique.mockResolvedValue({
      id: "srule-1",
      userId: USER,
    });

    const { deleteSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await deleteSubjectRuleForUser(USER, "srule-1");

    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { subjectRuleId: "srule-1" },
      data: { subjectRuleId: null },
    });
    expect(dbMock.subjectRule.delete).toHaveBeenCalledWith({
      where: { id: "srule-1" },
    });
  });

  it("is a no-op when the rule is already gone", async () => {
    dbMock.subjectRule.findUnique.mockResolvedValue(null);

    const { deleteSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await deleteSubjectRuleForUser(USER, "gone");

    expect(dbMock.subjectRule.delete).not.toHaveBeenCalled();
    expect(dbMock.message.updateMany).not.toHaveBeenCalled();
  });
});
