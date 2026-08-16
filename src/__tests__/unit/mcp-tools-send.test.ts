import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mail/send", () => ({
  sendMailForUser: vi.fn(),
}));

vi.mock("@/lib/demo", () => ({
  isDemoInstance: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  canManageConnections: vi.fn().mockResolvedValue(true),
  getConnectionCredentials: vi.fn(),
  getDefaultConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/mail/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/messages")>();
  return { ...actual, getMessages: vi.fn() };
});

vi.mock("@/lib/mail/threads", () => ({ getThreadMessages: vi.fn() }));
vi.mock("@/lib/mail/search", () => ({ searchMessages: vi.fn() }));
vi.mock("@/lib/mail/sidebar-counts", () => ({ getSidebarCounts: vi.fn() }));
vi.mock("@/lib/mail/files", () => ({ getFiles: vi.fn() }));
vi.mock("@/lib/mail/drafts", () => ({
  listDraftsForUser: vi.fn(),
  saveDraftForUser: vi.fn(),
  deleteDraftForUser: vi.fn(),
}));
vi.mock("@/lib/mail/mutations", () => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  setThreadReadState: vi.fn(),
  snoozeThread: vi.fn(),
  unsnoozeThread: vi.fn(),
  setThreadFollowUp: vi.fn(),
  dismissThreadFollowUp: vi.fn(),
  setThreadReplyLater: vi.fn(),
  approveSenderForUser: vi.fn(),
  skipSenderForUser: vi.fn(),
  unskipSenderForUser: vi.fn(),
  undoScreenActionForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
  changeSenderCategoryForUser: vi.fn(),
  setSenderUnthreadForUser: vi.fn(),
  setSenderAllowImagesForUser: vi.fn(),
  createDomainRuleForUser: vi.fn(),
  changeDomainRuleCategoryForUser: vi.fn(),
  deleteDomainRuleForUser: vi.fn(),
  listDomainRulesForUser: vi.fn(),
  bulkApproveOldSendersForUser: vi.fn(),
}));
vi.mock("@/lib/mail/scheduled-messages", () => ({
  updateScheduledForUser: vi.fn(),
  cancelScheduledForUser: vi.fn(),
  createScheduledMessageForUser: vi.fn(),
  sendScheduledNowForUser: vi.fn(),
  insertScheduledMessageForUser: vi.fn(),
  deliverScheduledNowForUser: vi.fn(),
}));
vi.mock("@/lib/mail/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/contacts")>();
  return {
    ...actual,
    getContactForUser: vi.fn(),
    deleteContactForUser: vi.fn(),
  };
});
vi.mock("@/lib/mail/contact-groups", () => ({
  addGroupMemberForUser: vi.fn(),
  createGroupForUser: vi.fn(),
  listGroupsForUser: vi.fn(),
  removeGroupMemberForUser: vi.fn(),
  renameGroupForUser: vi.fn(),
  setGroupDefaultTargetForUser: vi.fn(),
  deleteGroupForUser: vi.fn(),
}));
vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
  isOwnAddress: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitUploads: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  rateLimitSync: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 }),
  rateLimitSend: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
}));
vi.mock("@/lib/jobs/queue", () => ({
  getSyncQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@/lib/jobs/maintenance-tasks", () => ({
  approveOwnPendingSenders: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    sender: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    scheduledMessage: { findMany: vi.fn(), findFirst: vi.fn() },
    attachment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    emailConnection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn(), update: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    mcpConfirmation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    contactGroup: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { sendMailForUser } from "@/lib/mail/send";
import { insertScheduledMessageForUser } from "@/lib/mail/scheduled-messages";
import { isDemoInstance } from "@/lib/demo";
import { hashArgs } from "@/lib/mcp/canonical-json";
import { db } from "@/lib/db";
import { getTool } from "@/lib/mcp/tools";
import type { ToolContext } from "@/lib/mcp/types";
import { rateLimitSend } from "@/lib/rate-limit";

const baseArgs = {
  mode: "compose",
  to: ["a@b.com"],
  subject: "Hi",
  body: "Hello",
};

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "u1",
    tokenId: "t1",
    hasElicitation: true,
    ...overrides,
  };
}

async function call(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext = ctx(),
) {
  const tool = getTool(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(context, args);
}

function mockPendingConfirmation(toolName: string, args: unknown) {
  vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
    userId: "u1",
    tokenId: "t1",
    toolName,
    argsHash: hashArgs(args),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  } as never);
  vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 1 });
}

describe("MCP send tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      email: "me@example.com",
      sendAsEmail: null,
      isDefault: true,
    } as never);
    vi.mocked(db.mcpConfirmation.create).mockResolvedValue({} as never);
    vi.mocked(sendMailForUser).mockResolvedValue({
      messageId: "<sent@example.com>",
    });
  });

  it("send_mail without elicitation does not send", async () => {
    const result = await call(
      "send_mail",
      baseArgs,
      ctx({ hasElicitation: false }),
    );
    expect(result.type).toBe("error");
    expect(result).toMatchObject({
      type: "error",
      message: "this client cannot confirm this action",
    });
    expect(sendMailForUser).not.toHaveBeenCalled();
    expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
  });

  it("send_mail first call returns input_required", async () => {
    const result = await call("send_mail", baseArgs);
    expect(result.type).toBe("input_required");
    expect(result).toMatchObject({
      type: "input_required",
    });
    if (result.type === "input_required") {
      expect(result.requestState).toEqual(expect.any(String));
      expect(result.message).toMatch(/a@b.com/);
      expect(result.message).toMatch(/Hi/);
      expect(result.message).toMatch(/Hello/);
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(sendMailForUser).not.toHaveBeenCalled();
    expect(db.mcpConfirmation.create).toHaveBeenCalled();
  });

  it("send_mail accept with matching args sends once", async () => {
    mockPendingConfirmation("send_mail", baseArgs);
    const result = await call(
      "send_mail",
      baseArgs,
      ctx({
        requestState: "conf-1",
        inputResponses: { confirm: { action: "accept" } },
      }),
    );
    expect(result.type).toBe("ok");
    expect(sendMailForUser).toHaveBeenCalledTimes(1);
    expect(sendMailForUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        to: "a@b.com",
        subject: "Hi",
        text: "Hello",
      }),
    );
    expect(rateLimitSend).toHaveBeenCalledWith("u1");
  });

  it("send_mail passes the originating draft key through to the send core", async () => {
    const args = {
      ...baseArgs,
      draft: { type: "NEW", contextMessageId: "new-agent-draft-1" },
    };
    mockPendingConfirmation("send_mail", args);
    const result = await call(
      "send_mail",
      args,
      ctx({
        requestState: "conf-1",
        inputResponses: { confirm: { action: "accept" } },
      }),
    );
    expect(result.type).toBe("ok");
    expect(sendMailForUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        draft: { type: "NEW", contextMessageId: "new-agent-draft-1" },
      }),
    );
  });

  it("send_mail accept with swapped to does not send", async () => {
    mockPendingConfirmation("send_mail", baseArgs);
    const result = await call(
      "send_mail",
      { ...baseArgs, to: ["evil@b.com"] },
      ctx({
        requestState: "conf-1",
        inputResponses: { confirm: { action: "accept" } },
      }),
    );
    expect(result).toMatchObject({
      type: "error",
      message: "confirmation does not match arguments",
    });
    expect(sendMailForUser).not.toHaveBeenCalled();
  });

  it("send_mail on a demo instance errors without creating a confirmation", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);
    const result = await call("send_mail", baseArgs);
    expect(result).toMatchObject({
      type: "error",
      message: "Sending is disabled on this demo instance.",
    });
    expect(sendMailForUser).not.toHaveBeenCalled();
    expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
  });

  it("send_mail cancel does not send", async () => {
    mockPendingConfirmation("send_mail", baseArgs);
    const result = await call(
      "send_mail",
      baseArgs,
      ctx({
        requestState: "conf-1",
        inputResponses: { confirm: { action: "decline" } },
      }),
    );
    expect(result).toMatchObject({
      type: "error",
      message: "cancelled",
    });
    expect(sendMailForUser).not.toHaveBeenCalled();
  });

  it("schedule_mail 429 on accept does not consume the confirmation", async () => {
    const args = {
      ...baseArgs,
      scheduledFor: "2099-01-01T00:00:00.000Z",
    };
    mockPendingConfirmation("schedule_mail", args);
    vi.mocked(rateLimitSend).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 42,
    });
    const result = await call(
      "schedule_mail",
      args,
      ctx({
        requestState: "conf-1",
        inputResponses: { confirm: { action: "accept" } },
      }),
    );
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/Too many messages/),
    });
    expect(db.mcpConfirmation.updateMany).not.toHaveBeenCalled();
    expect(insertScheduledMessageForUser).not.toHaveBeenCalled();
  });
});
