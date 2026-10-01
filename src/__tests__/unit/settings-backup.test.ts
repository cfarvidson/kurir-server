import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SettingsBackupPayload } from "@/lib/mail/settings-backup-payload";

const createLocalSentMessage = vi.fn();
const appendToImapSent = vi.fn();
const approveSenderForUser = vi.fn();
const rejectSenderForUser = vi.fn();
const withImapConnection = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    emailConnection: { findMany: vi.fn(), findFirst: vi.fn() },
    contact: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    contactEmail: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    contactGroup: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contactGroupMember: { deleteMany: vi.fn(), createMany: vi.fn() },
    sender: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    domainRule: { findMany: vi.fn(), upsert: vi.fn() },
    subjectRule: { findMany: vi.fn(), upsert: vi.fn() },
    message: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    contentRule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    contentRuleSender: { upsert: vi.fn() },
    calendarAccount: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    attachment: { create: vi.fn(), findFirst: vi.fn() },
    folder: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: (...args: unknown[]) =>
    createLocalSentMessage(...args),
  appendToImapSent: (...args: unknown[]) => appendToImapSent(...args),
  getSentFolder: vi.fn(),
}));

vi.mock("@/lib/mail/mutations", () => ({
  approveSenderForUser: (...args: unknown[]) => approveSenderForUser(...args),
  rejectSenderForUser: (...args: unknown[]) => rejectSenderForUser(...args),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  withImapConnection: (...args: unknown[]) => withImapConnection(...args),
}));

vi.mock("@/lib/mail/tombstones", () => ({
  deleteMessagesWithTombstones: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/mail/domain-rules", () => ({
  patternMatchesDomain: vi.fn(() => false),
}));

const enqueueCalendarSyncJob = vi.fn();
vi.mock("@/lib/jobs/calendar-sync-worker", () => ({
  enqueueCalendarSyncJob: (...args: unknown[]) => enqueueCalendarSyncJob(...args),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (text: string) => `enc:${text}`,
  decrypt: (text: string) => text.replace(/^enc:/, ""),
}));

function payload(
  overrides: Partial<SettingsBackupPayload> = {},
): SettingsBackupPayload {
  return {
    kind: "kurir-settings-backup",
    version: 1,
    exportedAt: "2026-08-17T01:00:00.000Z",
    source: "manual",
    preferences: {
      theme: "dark",
      timezone: "UTC",
      blockRemoteImages: false,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: false,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    },
    contacts: [],
    contactGroups: [],
    senders: [
      {
        connectionEmail: "you@gmail.com",
        email: "news@github.com",
        domain: "github.com",
        status: "APPROVED",
        category: "FEED",
        unthread: true,
        allowRemoteImages: false,
      },
    ],
    domainRules: [],
    subjectRules: [],
    contentRules: [],
    calendarAccounts: [],
    snoozes: [],
    replyLater: [],
    followUps: [],
    ...overrides,
  };
}

describe("applySettingsBackupForUser", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      }
      return Promise.all(fn as Promise<unknown>[]);
    });
  });

  it("writes preferences and updates an existing sender by address", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com" },
    ] as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.sender.findFirst).mockResolvedValue({
      id: "snd-1",
      email: "news@github.com",
    } as never);
    vi.mocked(db.sender.update).mockResolvedValue({} as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    approveSenderForUser.mockResolvedValue(undefined);

    const { applySettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    const result = await applySettingsBackupForUser("user-1", payload());

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ theme: "dark", showFeedBadge: false }),
    });
    expect(db.sender.update).toHaveBeenCalledWith({
      where: { id: "snd-1" },
      data: expect.objectContaining({
        status: "APPROVED",
        category: "FEED",
        unthread: true,
      }),
    });
    expect(approveSenderForUser).toHaveBeenCalledWith(
      "user-1",
      "snd-1",
      "FEED",
    );
    expect(result.skippedConnections).toEqual([]);
  });

  it("creates a missing sender so future mail is already decided", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com" },
    ] as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.sender.findFirst).mockResolvedValue(null);
    vi.mocked(db.sender.create).mockResolvedValue({ id: "snd-new" } as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    approveSenderForUser.mockResolvedValue(undefined);

    const { applySettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await applySettingsBackupForUser("user-1", payload());

    expect(db.sender.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "news@github.com",
        emailConnectionId: "conn-1",
        userId: "user-1",
        status: "APPROVED",
        category: "FEED",
      }),
    });
    expect(approveSenderForUser).toHaveBeenCalledWith(
      "user-1",
      "snd-new",
      "FEED",
    );
  });

  it("restores AI rules with their senders and CalDAV calendars", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com" },
    ] as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.contentRule.findFirst).mockResolvedValue(null);
    vi.mocked(db.contentRule.create).mockResolvedValue({ id: "rule-1" } as never);
    vi.mocked(db.contentRuleSender.upsert).mockResolvedValue({} as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue(null);
    vi.mocked(db.calendarAccount.create).mockResolvedValue({ id: "cal-1" } as never);

    const { applySettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await applySettingsBackupForUser(
      "user-1",
      payload({
        senders: [],
        contentRules: [
          {
            connectionEmail: "you@gmail.com",
            criterion: "an invoice",
            onMatch: "PAPER_TRAIL",
            onNoMatch: "KEEP",
            senders: [
              { scope: "DOMAIN", scopeValue: "Shop.example", since: "2026-08-01T00:00:00.000Z" },
            ],
          },
        ],
        calendarAccounts: [
          {
            provider: "CALDAV",
            displayName: "iCloud",
            url: "https://caldav.example/home/",
            username: "you@icloud.com",
            password: "app-specific",
          },
        ],
        snoozes: [{ messageId: "<m1@example.com>", until: "2026-08-18T08:00:00.000Z" }],
        replyLater: ["<m2@example.com>"],
      }),
    );

    expect(db.contentRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        emailConnectionId: "conn-1",
        criterion: "an invoice",
        onMatch: "PAPER_TRAIL",
      }),
      select: { id: true },
    });
    expect(db.contentRuleSender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ruleId: "rule-1", scopeValue: "shop.example" }),
      }),
    );
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", messageId: "<m1@example.com>" },
      data: { isSnoozed: true, snoozedUntil: new Date("2026-08-18T08:00:00.000Z") },
    });
    expect(db.calendarAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "CALDAV",
        caldavUsername: "you@icloud.com",
        encryptedPassword: "enc:app-specific",
      }),
      select: { id: true },
    });
    expect(enqueueCalendarSyncJob).toHaveBeenCalledWith("cal-1", "user-1", { immediate: true });
  });

  it("skips a disconnected mailbox slice and still applies the rest", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com" },
    ] as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.sender.findFirst).mockResolvedValue(null);
    vi.mocked(db.sender.create).mockResolvedValue({ id: "snd-new" } as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    approveSenderForUser.mockResolvedValue(undefined);

    const { applySettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    const result = await applySettingsBackupForUser(
      "user-1",
      payload({
        senders: [
          {
            connectionEmail: "you@gmail.com",
            email: "news@github.com",
            domain: "github.com",
            status: "APPROVED",
            category: "FEED",
            unthread: false,
            allowRemoteImages: false,
          },
          {
            connectionEmail: "old@job.com",
            email: "hr@job.com",
            domain: "job.com",
            status: "REJECTED",
            category: null,
            unthread: false,
            allowRemoteImages: false,
          },
        ],
      }),
    );

    expect(result.skippedConnections).toEqual(["old@job.com"]);
    expect(db.sender.create).toHaveBeenCalledTimes(1);
    expect(rejectSenderForUser).not.toHaveBeenCalled();
  });
});

describe("writeSettingsBackupForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when there is no email connection", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([]);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
      theme: "system",
      blockRemoteImages: true,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);

    const { writeSettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await expect(
      writeSettingsBackupForUser("user-1", "manual"),
    ).rejects.toThrow(/connection/i);
    expect(createLocalSentMessage).not.toHaveBeenCalled();
  });

  it("throws when the connection has no Sent folder", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com", sendAsEmail: null, isDefault: true },
    ] as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);

    const { writeSettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await expect(
      writeSettingsBackupForUser("user-1", "manual"),
    ).rejects.toThrow(/sent folder/i);
    expect(createLocalSentMessage).not.toHaveBeenCalled();
  });

  it("persists a dummy Sent row and APPENDs to IMAP", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
      theme: "system",
      blockRemoteImages: true,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com", sendAsEmail: null, isDefault: true },
    ] as never);
    vi.mocked(db.contact.findMany).mockResolvedValue([]);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([]);
    vi.mocked(db.subjectRule.findMany).mockResolvedValue([]);
    vi.mocked(db.contentRule.findMany).mockResolvedValue([]);
    vi.mocked(db.calendarAccount.findMany).mockResolvedValue([]);
    vi.mocked(db.attachment.create).mockResolvedValue({ id: "att-1" } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "fold-sent",
      path: "Sent",
      specialUse: "sent",
    } as never);
    createLocalSentMessage.mockResolvedValue({ id: "msg-1" });
    appendToImapSent.mockResolvedValue(true);

    const { writeSettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    const result = await writeSettingsBackupForUser("user-1", "manual");

    expect(createLocalSentMessage).toHaveBeenCalled();
    expect(appendToImapSent).toHaveBeenCalled();
    expect(result).toEqual({ messageId: "msg-1", appendOk: true });
  });

  it("keeps the local row and reports appendOk false when APPEND fails", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
      theme: "system",
      blockRemoteImages: true,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com", sendAsEmail: null, isDefault: true },
    ] as never);
    vi.mocked(db.contact.findMany).mockResolvedValue([]);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([]);
    vi.mocked(db.subjectRule.findMany).mockResolvedValue([]);
    vi.mocked(db.contentRule.findMany).mockResolvedValue([]);
    vi.mocked(db.calendarAccount.findMany).mockResolvedValue([]);
    vi.mocked(db.attachment.create).mockResolvedValue({ id: "att-1" } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "fold-sent",
      path: "Sent",
      specialUse: "sent",
    } as never);
    createLocalSentMessage.mockResolvedValue({ id: "msg-1" });
    appendToImapSent.mockResolvedValue(false);

    const { writeSettingsBackupForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    const result = await writeSettingsBackupForUser("user-1", "scheduled");
    expect(result.appendOk).toBe(false);
    expect(result.messageId).toBe("msg-1");
  });
});

describe("processDueSettingsBackups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not advance nextRunAt when APPEND fails", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "user-1",
        timezone: "UTC",
        settingsBackupCadence: "daily",
        settingsBackupNextRunAt: new Date("2026-08-17T03:00:00.000Z"),
      },
    ] as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
      theme: "system",
      blockRemoteImages: true,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "you@gmail.com", sendAsEmail: null, isDefault: true },
    ] as never);
    vi.mocked(db.contact.findMany).mockResolvedValue([]);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([]);
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([]);
    vi.mocked(db.subjectRule.findMany).mockResolvedValue([]);
    vi.mocked(db.contentRule.findMany).mockResolvedValue([]);
    vi.mocked(db.calendarAccount.findMany).mockResolvedValue([]);
    vi.mocked(db.attachment.create).mockResolvedValue({ id: "att-1" } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "fold-sent",
      path: "Sent",
      specialUse: "sent",
    } as never);
    createLocalSentMessage.mockResolvedValue({ id: "msg-1" });
    appendToImapSent.mockResolvedValue(false);

    const { processDueSettingsBackups } = await import(
      "@/lib/mail/settings-backup"
    );
    await processDueSettingsBackups();

    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("setSettingsBackupCadenceForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears nextRunAt when turning off", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const { setSettingsBackupCadenceForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    const next = await setSettingsBackupCadenceForUser("user-1", "off");
    expect(next).toBeNull();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        settingsBackupCadence: "off",
        settingsBackupNextRunAt: null,
      },
    });
  });
});

describe("restoreSettingsBackupFromMessageForUser", () => {
  it("only looks up Sent snapshots", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    const { restoreSettingsBackupFromMessageForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await expect(
      restoreSettingsBackupFromMessageForUser("user-1", "msg-1"),
    ).rejects.toThrow("Backup not found");
    expect(db.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "msg-1",
          userId: "user-1",
          folder: { specialUse: "sent" },
        },
      }),
    );
    expect(approveSenderForUser).not.toHaveBeenCalled();
  });

  it("does not apply when no Sent backup exists", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    const { restoreSettingsBackupFromMessageForUser } = await import(
      "@/lib/mail/settings-backup"
    );
    await expect(
      restoreSettingsBackupFromMessageForUser("user-1", "inbox-msg"),
    ).rejects.toThrow("Backup not found");
    expect(approveSenderForUser).not.toHaveBeenCalled();
    expect(rejectSenderForUser).not.toHaveBeenCalled();
  });
});
