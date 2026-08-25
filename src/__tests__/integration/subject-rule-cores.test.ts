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

  it("strips reply/forward prefixes from the pattern (kurir-ios#58)", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule();
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.message.updateMany.mockResolvedValue({ count: 0 });

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "news@github.com",
      pattern: "Re: Fwd: Security digest",
      status: "APPROVED",
      category: "FEED",
    });

    expect(dbMock.subjectRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pattern: "security digest" }),
      }),
    );
    // The sweep queries with the stripped pattern; `contains` still finds
    // existing "Re: …" messages since the stripped pattern is a substring.
    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subject: { contains: "security digest", mode: "insensitive" },
        }),
      }),
    );
  });

  it("rejects a pattern that is nothing but a reply prefix", async () => {
    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await expect(
      createSubjectRuleForUser(USER, {
        senderId: "s1",
        scope: "ADDRESS",
        scopeValue: "a@b.com",
        pattern: "Re: ",
        status: "REJECTED",
      }),
    ).rejects.toThrow("Subject pattern must not be empty");
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

describe("retroactive sweep on create (kurir-ios#49)", () => {
  it("moves existing matching classified messages to the rule's category", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule({ status: "APPROVED", category: "FEED" });
    dbMock.message.findMany.mockResolvedValue([
      { id: "m1", uid: 11, folderId: "f-inbox" },
      { id: "m2", uid: 12, folderId: "f-inbox" },
    ]);
    dbMock.message.updateMany.mockResolvedValue({ count: 2 });

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "news@github.com",
      pattern: "security digest",
      status: "APPROVED",
      category: "FEED",
    });

    // The sweep only considers non-archived, currently classified mail
    // whose subject contains the pattern and whose sender is in scope.
    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailConnectionId: "c1",
          isArchived: false,
          subject: { contains: "security digest", mode: "insensitive" },
          sender: { email: "news@github.com" },
          OR: [
            { isInScreener: true },
            { isInImbox: true },
            { isInFeed: true },
            { isInPaperTrail: true },
          ],
        }),
      }),
    );
    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
        subjectRuleId: "srule-1",
      },
    });
  });

  it("matches subdomain scopes against the sender domain", async () => {
    mockSourceSender("bot@mail.github.com");
    mockUpsertedRule({
      scope: "SUBDOMAINS",
      scopeValue: "github.com",
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });
    dbMock.message.findMany.mockResolvedValue([]);

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "SUBDOMAINS",
      scopeValue: "github.com",
      pattern: "digest",
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });

    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sender: {
            OR: [
              { domain: "github.com" },
              { domain: { endsWith: ".github.com" } },
            ],
          },
        }),
      }),
    );
  });

  it("screen-out rules archive matches and defer the IMAP inbox move", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule({ status: "REJECTED", category: null });
    dbMock.message.findMany.mockResolvedValue([
      { id: "m1", uid: 11, folderId: "f-inbox" },
      { id: "m2", uid: -5, folderId: "f-inbox" }, // local row: no IMAP move
      { id: "m3", uid: 7, folderId: "f-other" }, // other folder: no IMAP move
    ]);
    dbMock.message.updateMany.mockResolvedValue({ count: 3 });
    dbMock.folder.findFirst.mockResolvedValue({ id: "f-inbox" });

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "news@github.com",
      pattern: "digest",
      status: "REJECTED",
    });

    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2", "m3"] } },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: true,
        isSnoozed: false,
        snoozedUntil: null,
        subjectRuleId: "srule-1",
      },
    });

    const { after } = await import("next/server");
    expect(after).toHaveBeenCalledTimes(1);
    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    vi.mocked(moveToArchiveViaImap).mockResolvedValue(undefined);
    const deferred = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await deferred();
    expect(moveToArchiveViaImap).toHaveBeenCalledWith(
      USER,
      "c1",
      "f-inbox",
      [11],
    );
  });

  it("does nothing extra when nothing matches", async () => {
    mockSourceSender("news@github.com");
    mockUpsertedRule();
    dbMock.message.findMany.mockResolvedValue([]);

    const { createSubjectRuleForUser } = await import("@/lib/mail/mutations");
    await createSubjectRuleForUser(USER, {
      senderId: "s1",
      scope: "ADDRESS",
      scopeValue: "news@github.com",
      pattern: "digest",
      status: "APPROVED",
      category: "FEED",
    });

    expect(dbMock.message.updateMany).not.toHaveBeenCalled();
    const { after } = await import("next/server");
    expect(after).not.toHaveBeenCalled();
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

describe("subject-rule precedence over sender decisions (kurir-ios#48)", () => {
  it("approving a sender never re-files subject-ruled mail", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      email: "news@github.com",
      displayName: null,
    });

    const { approveSenderForUser } = await import("@/lib/mail/mutations");
    await approveSenderForUser(USER, "s1", "IMBOX");

    expect(dbMock.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectRuleId: null }),
      }),
    );
  });

  it("rejecting a sender never archives subject-ruled mail", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      emailConnectionId: "c1",
    });
    dbMock.message.findMany.mockResolvedValue([]);
    dbMock.folder.findFirst.mockResolvedValue(null);

    const { rejectSenderForUser } = await import("@/lib/mail/mutations");
    await rejectSenderForUser(USER, "s1");

    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectRuleId: null }),
      }),
    );
    expect(dbMock.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectRuleId: null }),
      }),
    );
  });

  it("changing a sender's category never re-files subject-ruled mail", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      status: "APPROVED",
    });

    const { changeSenderCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );
    await changeSenderCategoryForUser(USER, "s1", "FEED");

    expect(dbMock.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectRuleId: null }),
      }),
    );
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
