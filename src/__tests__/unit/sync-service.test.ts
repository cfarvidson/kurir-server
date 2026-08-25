/**
 * Unit tests for the sync service (syncEmailConnection).
 * Verifies that sync is scoped to an EmailConnection, not a User.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findUnique: vi.fn(),
    },
    folder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sender: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attachment: {
      createMany: vi.fn(),
    },
    domainRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    subjectRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock ImapFlow to avoid real network calls
vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue({
      messages: 0,
      uidNext: 1,
      uidValidity: 1n,
      highestModseq: 1n,
    }),
    getMailboxLock: vi.fn().mockResolvedValue({
      release: vi.fn(),
    }),
  })),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

vi.mock("@/lib/mail/flag-push", () => ({
  suppressEcho: vi.fn(),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  findArchiveMailbox: vi.fn(),
}));

describe("syncEmailConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when connection credentials not found", async () => {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("non-existent-conn");

    expect(result.success).toBe(false);
    expect(result.error).toContain("credentials not found");
  });

  it("returns error when email connection record not found", async () => {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue({
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.example.com", port: 993 },
      smtp: { host: "smtp.example.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Email connection not found");
  });

  it("calls getConnectionCredentialsInternal with the connectionId (not userId)", async () => {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    await syncEmailConnection("conn-abc-123");

    expect(getConnectionCredentialsInternal).toHaveBeenCalledWith(
      "conn-abc-123",
    );
    // Importantly: NOT called with userId
    expect(getConnectionCredentialsInternal).not.toHaveBeenCalledWith(
      expect.not.stringMatching("conn-abc-123"),
    );
  });

  it("looks up emailConnection to get userId", async () => {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue({
      email: "me@gmail.com",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-99",
    } as any);
    // ImapFlow connect will fail, caught in try/catch
    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connect failed")),
        logout: vi.fn().mockResolvedValue(undefined),
      };
    } as any);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    await syncEmailConnection("conn-1");

    expect(db.emailConnection.findUnique).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      select: { userId: true },
    });
  });
});

describe("thread repair gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const REPAIR_CALL = {
    where: { userId: "user-1" },
    select: { id: true, messageId: true, threadId: true, inReplyTo: true },
  };

  function mockCredentials() {
    return {
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.example.com", port: 993 },
      smtp: { host: "smtp.example.com", port: 587 },
    };
  }

  function fakeMsg(uid: number) {
    return {
      uid,
      envelope: {
        messageId: `<msg-${uid}@example.com>`,
        from: [{ address: "sender@example.com", name: "Sender" }],
        to: [{ address: "me@example.com" }],
        subject: "Test",
        date: new Date(),
        inReplyTo: null,
      },
      flags: new Set<string>(),
      internalDate: new Date(),
      source: Buffer.from("raw email"),
    };
  }

  async function setupImapFlow(overrides: {
    search: unknown;
    messages?: ReturnType<typeof fakeMsg>[];
  }) {
    const { ImapFlow } = await import("imapflow");
    const messages = overrides.messages ?? [];
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        search: vi.fn().mockResolvedValue(overrides.search),
        status: vi.fn().mockResolvedValue({
          messages: 0,
          uidNext: 1,
          uidValidity: 1n,
          highestModseq: 1n,
        }),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(function* () {
          yield* messages;
        }),
      };
    } as any);
  }

  async function commonMocks() {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue(
      mockCredentials(),
    );

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.folder.findUnique).mockResolvedValue({
      id: "folder-1",
      uidValidity: null,
      specialUse: "inbox",
      lastExaminedUid: 0,
    } as any);
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "sender-1",
      status: "PENDING",
      category: "IMBOX",
    } as any);
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);

    const { simpleParser } = await import("mailparser");
    vi.mocked(simpleParser).mockResolvedValue({
      text: "Hello",
      html: null,
      attachments: [],
      references: [],
    } as any);

    return db;
  }

  it("skips the repair when a caught-up sync processes no messages", async () => {
    const db = await commonMocks();
    await setupImapFlow({ search: [] });

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(true);
    expect(result.results[0].newMessages).toBe(0);
    expect(result.results[0].remaining).toBe(0);
    expect(db.message.findMany).not.toHaveBeenCalledWith(REPAIR_CALL);
  });

  it("runs the repair when a drained sync processed one message", async () => {
    const db = await commonMocks();
    await setupImapFlow({ search: [5], messages: [fakeMsg(5)] });

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(true);
    expect(result.results[0].newMessages).toBe(1);
    expect(result.results[0].remaining).toBe(0);
    expect(db.message.findMany).toHaveBeenCalledWith(REPAIR_CALL);
  });

  it("defers the repair while a backfill still has remaining messages", async () => {
    const db = await commonMocks();
    // Two UIDs on the server, batchSize of 1 leaves one remaining.
    await setupImapFlow({ search: [5, 6], messages: [fakeMsg(6)] });

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1", { batchSize: 1 });

    expect(result.success).toBe(true);
    expect(result.results[0].newMessages).toBe(1);
    expect(result.results[0].remaining).toBe(1);
    expect(db.message.findMany).not.toHaveBeenCalledWith(REPAIR_CALL);
  });
});

describe("domain rules at sync (plan 033)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fakeMsg = (from: string) =>
    ({
      uid: 1,
      envelope: {
        messageId: "<test@example.com>",
        from: [{ address: from, name: "Sender" }],
        to: [{ address: "me@example.com" }],
        subject: "Test",
        date: new Date(),
        inReplyTo: null,
      },
      flags: new Set<string>(),
      internalDate: new Date(),
      source: Buffer.from("raw email"),
    }) as any;

  async function mockPersistence(senderState: {
    status: string;
    category: string | null;
  }) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "sender-1",
      ...senderState,
    } as any);
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);

    const { simpleParser } = await import("mailparser");
    vi.mocked(simpleParser).mockResolvedValue({
      text: "Hello",
      html: null,
      attachments: [],
      references: [],
    } as any);
    return db;
  }

  const approveRule = {
    id: "rule-1",
    pattern: "github.com",
    includeSubdomains: true,
    status: "APPROVED",
    category: "PAPER_TRAIL",
  } as const;

  it("creates a rule-matched sender decided by the rule (never PENDING)", async () => {
    const db = await mockPersistence({
      status: "APPROVED",
      category: "PAPER_TRAIL",
    });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("bot@news.github.com"),
      "user-1",
      "conn-1",
      "folder-1",
      {
        isInbox: true,
        own: { emails: ["me@example.com"], domains: [] },
        domainRules: [approveRule as any],
      },
    );

    expect(db.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "APPROVED",
          category: "PAPER_TRAIL",
          decidedByRuleId: "rule-1",
          decidedAt: expect.any(Date),
        }),
      }),
    );
    // Message lands in Paper Trail, never in the screener
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInScreener: false,
          isInPaperTrail: true,
        }),
      }),
    );
  });

  it("archives inbox mail from a sender created by a REJECTED rule", async () => {
    const db = await mockPersistence({ status: "REJECTED", category: null });

    const rejectRule = {
      id: "rule-2",
      pattern: "spam.example",
      includeSubdomains: false,
      status: "REJECTED",
      category: null,
    };

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("noreply@spam.example"),
      "user-1",
      "conn-1",
      "folder-1",
      {
        isInbox: true,
        own: { emails: ["me@example.com"], domains: [] },
        domainRules: [rejectRule as any],
      },
    );

    expect(db.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "REJECTED",
          decidedByRuleId: "rule-2",
        }),
      }),
    );
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInScreener: false,
          isArchived: true,
        }),
      }),
    );
  });

  it("own address wins over a matching rule", async () => {
    const db = await mockPersistence({ status: "APPROVED", category: "IMBOX" });

    const rejectOwnDomain = {
      id: "rule-3",
      pattern: "example.com",
      includeSubdomains: true,
      status: "REJECTED",
      category: null,
    };

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("me@example.com"),
      "user-1",
      "conn-1",
      "folder-1",
      {
        isInbox: true,
        own: { emails: ["me@example.com"], domains: [] },
        domainRules: [rejectOwnDomain as any],
      },
    );

    expect(db.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "APPROVED",
          category: "IMBOX",
        }),
      }),
    );
    const createArg = vi.mocked(db.sender.upsert).mock.calls[0][0] as any;
    expect(createArg.create.decidedByRuleId).toBeUndefined();
  });

  it("loads the connection's rules once per sync run", async () => {
    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue({
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.example.com", port: 993 },
      smtp: { host: "smtp.example.com", port: 587 },
    });
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([]);

    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
      };
    } as any);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    await syncEmailConnection("conn-1");

    expect(db.domainRule.findMany).toHaveBeenCalledTimes(1);
    expect(db.domainRule.findMany).toHaveBeenCalledWith({
      where: { emailConnectionId: "conn-1" },
    });
    expect(db.subjectRule.findMany).toHaveBeenCalledTimes(1);
    expect(db.subjectRule.findMany).toHaveBeenCalledWith({
      where: { emailConnectionId: "conn-1" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("subject rules at ingest (kurir-ios#48)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fakeMsg = (from: string, subject: string) =>
    ({
      uid: 1,
      envelope: {
        messageId: "<test@example.com>",
        from: [{ address: from, name: "Sender" }],
        to: [{ address: "me@example.com" }],
        subject,
        date: new Date(),
        inReplyTo: null,
      },
      flags: new Set<string>(),
      internalDate: new Date(),
      source: Buffer.from("raw email"),
    }) as any;

  async function mockPersistence(senderState: {
    status: string;
    category: string | null;
  }) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "sender-1",
      ...senderState,
    } as any);
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);

    const { simpleParser } = await import("mailparser");
    vi.mocked(simpleParser).mockResolvedValue({
      text: "Hello",
      html: null,
      attachments: [],
      references: [],
    } as any);
    return db;
  }

  const OWN = { emails: ["me@example.com"], domains: [] };

  const feedRule = {
    id: "srule-1",
    scope: "ADDRESS",
    scopeValue: "news@github.com",
    pattern: "security digest",
    status: "APPROVED",
    category: "FEED",
  } as const;

  it("routes a matching message by the rule even though the sender is PENDING", async () => {
    const db = await mockPersistence({ status: "PENDING", category: null });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("news@github.com", "Your Security Digest for May"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN, subjectRules: [feedRule as any] },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInScreener: false,
          isInFeed: true,
          isInImbox: false,
          isArchived: false,
          subjectRuleId: "srule-1",
        }),
      }),
    );
  });

  it("leaves a non-matching message from the same sender to the sender's decision", async () => {
    const db = await mockPersistence({ status: "APPROVED", category: "IMBOX" });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("news@github.com", "Welcome to GitHub"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN, subjectRules: [feedRule as any] },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInImbox: true,
          isInFeed: false,
          subjectRuleId: null,
        }),
      }),
    );
  });

  it("archives a message matching a REJECTED rule even from an APPROVED sender", async () => {
    const db = await mockPersistence({ status: "APPROVED", category: "IMBOX" });

    const rejectRule = {
      id: "srule-2",
      scope: "DOMAIN",
      scopeValue: "github.com",
      pattern: "[bot]",
      status: "REJECTED",
      category: null,
    };

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("news@github.com", "[bot] dependency bump"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN, subjectRules: [rejectRule as any] },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isArchived: true,
          isInImbox: false,
          isInScreener: false,
          subjectRuleId: "srule-2",
        }),
      }),
    );
  });

  it("an APPROVED subject rule beats a REJECTED sender", async () => {
    const db = await mockPersistence({ status: "REJECTED", category: null });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("news@github.com", "security digest weekly"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN, subjectRules: [feedRule as any] },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInFeed: true,
          isArchived: false,
          subjectRuleId: "srule-1",
        }),
      }),
    );
  });

  it("own-address mail ignores subject rules", async () => {
    const db = await mockPersistence({ status: "APPROVED", category: "IMBOX" });

    const ownRule = {
      id: "srule-3",
      scope: "ADDRESS",
      scopeValue: "me@example.com",
      pattern: "test",
      status: "REJECTED",
      category: null,
    };

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("me@example.com", "test message"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN, subjectRules: [ownRule as any] },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isArchived: false,
          isInImbox: true,
          subjectRuleId: null,
        }),
      }),
    );
  });

  it("retroactive own-sender auto-approve leaves subject-ruled mail in place (kurir-ios#60)", async () => {
    const db = await mockPersistence({ status: "PENDING", category: "IMBOX" });
    vi.mocked(db.sender.update).mockResolvedValue({
      id: "sender-1",
      status: "APPROVED",
      category: "IMBOX",
    } as any);

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg("me@example.com", "hello"),
      "user-1",
      "conn-1",
      "folder-1",
      { isInbox: true, own: OWN },
    );

    // The screener sweep must not re-file messages a subject rule placed.
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { senderId: "sender-1", isInScreener: true, subjectRuleId: null },
      data: { isInScreener: false, isInImbox: true },
    });
  });
});

describe("processMessage scoping", () => {
  it("stores message with emailConnectionId field", async () => {
    const { db } = await import("@/lib/db");

    // Minimal mocks for processMessage
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "sender-1",
      status: "PENDING",
      category: "IMBOX",
    } as any);
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);

    const { simpleParser } = await import("mailparser");
    vi.mocked(simpleParser).mockResolvedValue({
      text: "Hello",
      html: null,
      attachments: [],
      references: [],
    } as any);

    const { processMessage } = await import("@/lib/mail/sync-service");

    const fakeMsg = {
      uid: 1,
      envelope: {
        messageId: "<test@example.com>",
        from: [{ address: "sender@example.com", name: "Sender" }],
        to: [{ address: "me@example.com" }],
        subject: "Test",
        date: new Date(),
        inReplyTo: null,
      },
      flags: new Set<string>(),
      internalDate: new Date(),
      source: Buffer.from("raw email"),
    };

    await processMessage(
      fakeMsg as any,
      "user-1",
      "conn-42", // emailConnectionId
      "folder-1",
      {
        isInbox: true,
        own: { emails: ["me@example.com"], domains: [] },
      },
    );

    // Verify message was created with the emailConnectionId
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailConnectionId: "conn-42",
          userId: "user-1",
          folderId: "folder-1",
        }),
      }),
    );
  });
});
