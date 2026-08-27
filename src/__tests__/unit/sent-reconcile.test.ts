/**
 * Sent-folder sync hardening (kurir-server#138):
 * 1. Message-ID reconciliation regardless of uid sign — a second IMAP copy
 *    of the same mail must reconcile, not insert a duplicate row.
 * 2. Reconciliation re-runs thread assignment instead of freezing the
 *    send-time threadId.
 * 3. The content fallback compares snippets computed by the ONE shared
 *    createSnippet, so multi-line bodies can actually match.
 * 4. A server without \Sent gets its name-matched Sent folder labeled
 *    specialUse "sent".
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
      updateMany: vi.fn(),
    },
    domainRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    subjectRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

vi.mock("@/lib/mail/flag-push", () => ({
  suppressEcho: vi.fn(),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  findArchiveMailbox: vi.fn(),
  withImapConnection: vi.fn(),
}));

function fakeMsg(overrides: {
  uid: number;
  messageId: string | null;
  from?: string;
  subject?: string;
  date?: Date;
  inReplyTo?: string | null;
}) {
  return {
    uid: overrides.uid,
    envelope: {
      messageId: overrides.messageId,
      from: [{ address: overrides.from ?? "me@example.com", name: "Me" }],
      to: [{ address: "you@example.com" }],
      subject: overrides.subject ?? "Test",
      date: overrides.date ?? new Date(),
      inReplyTo: overrides.inReplyTo ?? null,
    },
    flags: new Set<string>(),
    internalDate: new Date(),
    source: Buffer.from("raw email"),
  } as any;
}

async function mockParsed(overrides?: { text?: string; references?: string[] }) {
  const { simpleParser } = await import("mailparser");
  vi.mocked(simpleParser).mockResolvedValue({
    text: overrides?.text ?? "Hello",
    html: null,
    attachments: [],
    references: overrides?.references ?? [],
  } as any);
}

async function baseMocks() {
  const { db } = await import("@/lib/db");
  vi.mocked(db.sender.upsert).mockResolvedValue({
    id: "sender-1",
    status: "APPROVED",
    category: "IMBOX",
  } as any);
  vi.mocked(db.sender.update).mockResolvedValue({} as any);
  vi.mocked(db.message.findFirst).mockResolvedValue(null);
  vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
  vi.mocked(db.message.update).mockResolvedValue({ id: "msg-1" } as any);
  vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);
  await mockParsed();
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sent reconciliation dedup (Message-ID, uid-sign agnostic)", () => {
  it("reconciles a second IMAP copy in the same folder instead of inserting a duplicate", async () => {
    const db = await baseMocks();
    // First copy already synced with a real (positive) uid.
    vi.mocked(db.message.findFirst).mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      if (typeof w.messageId === "string" && w.OR) {
        return { id: "existing-1", uid: 77, folderId: "sent-folder" } as any;
      }
      return null;
    });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg({ uid: 99, messageId: "<sent@x>" }),
      "user-1",
      "conn-1",
      "sent-folder",
      { isInbox: false },
    );

    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-1" },
        data: expect.objectContaining({ uid: 99, folderId: "sent-folder" }),
      }),
    );
    // The dedup lookup must not be limited to placeholder rows.
    const dedupCall = vi
      .mocked(db.message.findFirst)
      .mock.calls.map((c: any[]) => c[0].where)
      .find((w: any) => typeof w.messageId === "string");
    expect(dedupCall.OR).toEqual([
      { uid: { lt: 0 } },
      { folderId: "sent-folder" },
    ]);
  });

  it("re-runs thread assignment when reconciling a local placeholder", async () => {
    const db = await baseMocks();
    await mockParsed({ references: ["<anchor@x>"] });
    vi.mocked(db.message.findFirst).mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      // Thread resolve: a related message with a threadId exists.
      if (w.OR?.[0]?.messageId?.in) {
        return { threadId: "<thread@x>" } as any;
      }
      // Dedup: the local placeholder row from the send.
      if (typeof w.messageId === "string") {
        return { id: "placeholder-1", uid: -5 } as any;
      }
      return null;
    });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg({ uid: 12, messageId: "<sent@x>", inReplyTo: "<anchor@x>" }),
      "user-1",
      "conn-1",
      "sent-folder",
      { isInbox: false },
    );

    expect(db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "placeholder-1" },
        data: expect.objectContaining({
          uid: 12,
          threadId: "<thread@x>",
          inReplyTo: "<anchor@x>",
          references: ["<anchor@x>"],
        }),
      }),
    );
    expect(db.message.create).not.toHaveBeenCalled();
  });
});

describe("content fallback with the shared snippet computation", () => {
  it("persist-sent stores the same snippet the sync-side lookup computes", async () => {
    const db = await baseMocks();
    const multiline = "First line of the reply\nSecond line\n\n> quoted tail";

    // Persist the local sent copy and capture the stored snippet.
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "sent-folder",
      path: "Sent",
    } as any);
    let storedSnippet: string | null = null;
    vi.mocked(db.message.create).mockImplementation(async (args: any) => {
      storedSnippet = args.data.snippet;
      return { id: "local-1", ...args.data } as any;
    });
    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    await createLocalSentMessage({
      userId: "user-1",
      emailConnectionId: "conn-1",
      messageId: "<old@x>",
      threadId: null,
      inReplyTo: null,
      references: [],
      subject: "Test",
      fromAddress: "me@example.com",
      toAddresses: ["you@example.com"],
      text: multiline,
    });

    // Sync the delivered copy (MTA rewrote the Message-ID) and capture the
    // snippet the content-fallback lookup queries with.
    await mockParsed({ text: multiline });
    let queriedSnippet: string | undefined;
    vi.mocked(db.message.findFirst).mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      if (w.uid?.lt === 0 && w.fromAddress) {
        queriedSnippet = w.snippet;
        return {
          id: "local-1",
          uid: -5,
          messageId: "<old@x>",
        } as any;
      }
      return null;
    });

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      fakeMsg({ uid: 33, messageId: "<new@x>", subject: "Test" }),
      "user-1",
      "conn-1",
      "sent-folder",
      { isInbox: false },
    );

    expect(storedSnippet).toBe(
      "First line of the reply Second line > quoted tail",
    );
    expect(queriedSnippet).toBe(storedSnippet);
    // Reconciled, not duplicated — and threading is repaired, not frozen.
    expect(db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "local-1" },
        data: expect.objectContaining({
          uid: 33,
          messageId: "<new@x>",
          threadId: "<new@x>",
        }),
      }),
    );
    // Thread keys pointing at the send-time Message-ID follow the rewrite.
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", inReplyTo: "<old@x>" },
      data: { inReplyTo: "<new@x>" },
    });
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", threadId: "<old@x>" },
      data: { threadId: "<new@x>" },
    });
  });
});

describe("\\Sent-less servers", () => {
  it("labels a name-matched Sent folder specialUse 'sent'", async () => {
    const db = await baseMocks();

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
    } as any);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.folder.findUnique).mockResolvedValue(null);
    vi.mocked(db.folder.create).mockImplementation(
      async (args: any) =>
        ({
          id: `folder-${args.data.path}`,
          uidValidity: null,
          lastExaminedUid: 0,
          ...args.data,
        }) as any,
    );
    vi.mocked(db.folder.update).mockResolvedValue({} as any);
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        // No specialUse flags advertised at all.
        list: vi.fn().mockResolvedValue([{ path: "Sent Messages" }]),
        search: vi.fn().mockResolvedValue([]),
        status: vi.fn().mockResolvedValue({
          messages: 0,
          uidNext: 1,
          uidValidity: 1n,
          highestModseq: 1n,
        }),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(function* () {}),
      };
    } as any);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(true);
    expect(db.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          path: "Sent Messages",
          specialUse: "sent",
        }),
      }),
    );
  });

  it("prefers the advertised \\Sent mailbox over a name match", async () => {
    const db = await baseMocks();

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
    } as any);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.folder.findUnique).mockResolvedValue(null);
    vi.mocked(db.folder.create).mockImplementation(
      async (args: any) =>
        ({
          id: `folder-${args.data.path}`,
          uidValidity: null,
          lastExaminedUid: 0,
          ...args.data,
        }) as any,
    );
    vi.mocked(db.folder.update).mockResolvedValue({} as any);
    vi.mocked(db.message.findMany).mockResolvedValue([]);

    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        // A name-decoy listed before the real \Sent mailbox.
        list: vi.fn().mockResolvedValue([
          { path: "Sent-Archive-2019" },
          { path: "Skickat", specialUse: "\\Sent" },
        ]),
        search: vi.fn().mockResolvedValue([]),
        status: vi.fn().mockResolvedValue({
          messages: 0,
          uidNext: 1,
          uidValidity: 1n,
          highestModseq: 1n,
        }),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(function* () {}),
      };
    } as any);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(true);
    expect(db.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ path: "Skickat", specialUse: "sent" }),
      }),
    );
    expect(db.folder.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ path: "Sent-Archive-2019" }),
      }),
    );
  });
});
