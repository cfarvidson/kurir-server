/**
 * Integration test for subject rules on the IMAP IDLE ingest path
 * (kurir-ios#59): a new message arriving via IDLE runs through the REAL
 * `processMessage` (unlike idle-handlers.test.ts, which mocks it away), so
 * this proves the rule classifies there too — including encoded-word
 * subjects and NFC/NFD unicode folding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
  syncState: { findUnique: vi.fn() },
  emailConnection: { findUnique: vi.fn() },
  domainRule: { findMany: vi.fn() },
  subjectRule: { findMany: vi.fn() },
  folder: { findUnique: vi.fn(), findFirst: vi.fn() },
  message: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  sender: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  attachment: { createMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getConnectionCredentialsInternal: vi.fn() }));
vi.mock("@/lib/mail/sync-lock", () => ({ isSyncLockHeld: vi.fn() }));
vi.mock("@/lib/mail/sse-subscribers", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/mail/push-sender", () => ({
  pushToUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/mail/flag-push", () => ({
  isEcho: vi.fn().mockReturnValue(false),
  suppressEcho: vi.fn(),
}));
vi.mock("@/lib/mail/imap-client", () => ({ findArchiveMailbox: vi.fn() }));
vi.mock("@/lib/calendar/ingest", () => ({
  ingestMeetingFromParsed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/mail/connection-manager", () => ({
  connectionManager: { getConnection: vi.fn(), touchActivity: vi.fn() },
}));

const CONNECTION_ID = "conn-1";
const USER_ID = "user-1";
const FOLDER_ID = "folder-inbox";

/** A live IDLE connection whose fetch yields the given raw messages. */
function makeConn(fetchMessages: unknown[]) {
  return {
    connectionId: CONNECTION_ID,
    userId: USER_ID,
    client: {
      fetch: vi.fn(function* () {
        for (const m of fetchMessages) yield m;
      }),
      on: vi.fn(),
    },
    folderId: FOLDER_ID,
    debounceTimers: new Map<string, NodeJS.Timeout>(),
    newMessageRetryAttempts: 0,
    newMessageCheckInFlight: false,
  };
}

/** A raw IMAP message: real RFC822 source so the real mailparser runs. */
function imapMsg(uid: number, envelopeSubject: string) {
  const source = Buffer.from(
    [
      "From: News <news@github.com>",
      "To: me@example.com",
      `Subject: ${envelopeSubject}`,
      `Message-ID: <idle-${uid}@example.com>`,
      "Date: Tue, 25 Aug 2026 10:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello from the IDLE path",
    ].join("\r\n"),
  );
  return {
    uid,
    envelope: {
      messageId: `<idle-${uid}@example.com>`,
      from: [{ address: "news@github.com", name: "News" }],
      to: [{ address: "me@example.com" }],
      subject: envelopeSubject,
      date: new Date("2026-08-25T10:00:00Z"),
      inReplyTo: null,
    },
    flags: new Set<string>(),
    internalDate: new Date("2026-08-25T10:00:00Z"),
    source,
  };
}

const feedRule = {
  id: "srule-idle",
  scope: "ADDRESS",
  scopeValue: "news@github.com",
  pattern: "s\u00e4kerhetsdigest", // säkerhetsdigest, NFC
  status: "APPROVED",
  category: "FEED",
};

beforeEach(async () => {
  vi.clearAllMocks();

  dbMock.emailConnection.findUnique.mockResolvedValue({
    email: "me@example.com",
    sendAsEmail: null,
    aliases: [],
    treatDomainAsOwn: false,
  });
  dbMock.domainRule.findMany.mockResolvedValue([]);
  dbMock.subjectRule.findMany.mockResolvedValue([feedRule]);
  // Highest-UID lookup reports cached mail so ingest runs; every other
  // findFirst (exists check, threading, local-duplicate dedup) sees nothing.
  dbMock.message.findFirst.mockImplementation((args: any) =>
    Promise.resolve(args?.orderBy?.uid === "desc" ? { uid: 1 } : null),
  );
  dbMock.message.create.mockImplementation((args: any) =>
    Promise.resolve({ id: "m-idle", ...args.data }),
  );
  dbMock.message.updateMany.mockResolvedValue({ count: 0 });
  dbMock.sender.upsert.mockResolvedValue({
    id: "sender-1",
    status: "PENDING",
    category: "IMBOX",
  });
  dbMock.sender.update.mockResolvedValue({});

  const { connectionManager } = await import("@/lib/mail/connection-manager");
  const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
  vi.mocked(isSyncLockHeld).mockResolvedValue(false);
  vi.mocked(connectionManager.getConnection).mockReset();
});

async function runIdleIngest(message: unknown) {
  const { connectionManager } = await import("@/lib/mail/connection-manager");
  const conn = makeConn([message]);
  vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
  const { checkForNewMessages } = await import("@/lib/mail/idle-handlers");
  await checkForNewMessages(CONNECTION_ID);
}

describe("subject rules on the IDLE ingest path (kurir-ios#59)", () => {
  it("a new IDLE message gets subjectRuleId and the rule's placement", async () => {
    // Subject with ä decomposed (NFD): the rule's NFC pattern must still hit.
    await runIdleIngest(imapMsg(5, "Din sa\u0308kerhetsdigest f\u00f6r maj"));

    expect(dbMock.message.create).toHaveBeenCalledTimes(1);
    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          uid: 5,
          folderId: FOLDER_ID,
          isInScreener: false,
          isInFeed: true,
          isInImbox: false,
          isArchived: false,
          subjectRuleId: "srule-idle",
        }),
      }),
    );
  });

  it("a non-matching IDLE message follows the PENDING sender to the screener", async () => {
    await runIdleIngest(imapMsg(6, "Welcome to GitHub"));

    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInScreener: true,
          isInFeed: false,
          subjectRuleId: null,
        }),
      }),
    );
  });

  it("an encoded-word subject is decoded, matched, and stored decoded", async () => {
    // "Säkerhetsdigest" as a raw RFC 2047 encoded-word in the envelope, as
    // relayed by a server that does not decode it.
    await runIdleIngest(imapMsg(7, "=?UTF-8?B?U8Oka2VyaGV0c2RpZ2VzdA==?="));

    expect(dbMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: "Säkerhetsdigest",
          isInFeed: true,
          subjectRuleId: "srule-idle",
        }),
      }),
    );
  });
});
