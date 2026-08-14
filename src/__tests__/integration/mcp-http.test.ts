import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/tokens", () => ({
  verifyMcpAccessToken: vi.fn(),
  issueMcpTokens: vi.fn(),
  rotateMcpTokens: vi.fn(),
  revokeMcpTokenById: vi.fn(),
  revokeMcpTokenByAccessToken: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

vi.mock("@/lib/auth", () => ({
  canManageConnections: vi.fn().mockResolvedValue(true),
  auth: vi.fn(),
  requireAuth: vi.fn(),
  getConnectionCredentialsInternal: vi.fn(),
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
vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
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
  changeSenderCategoryForUser: vi.fn(),
  setSenderUnthreadForUser: vi.fn(),
  setSenderAllowImagesForUser: vi.fn(),
  createDomainRuleForUser: vi.fn(),
  changeDomainRuleCategoryForUser: vi.fn(),
  deleteDomainRuleForUser: vi.fn(),
  listDomainRulesForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
  bulkApproveOldSendersForUser: vi.fn(),
}));
vi.mock("@/lib/mail/scheduled-messages", () => ({
  updateScheduledForUser: vi.fn(),
  cancelScheduledForUser: vi.fn(),
  insertScheduledMessageForUser: vi.fn(),
  deliverScheduledNowForUser: vi.fn(),
}));
vi.mock("@/lib/mail/send", () => ({
  sendMailForUser: vi.fn(),
  SendMailError: class SendMailError extends Error {},
}));
vi.mock("@/lib/mcp/confirmations", () => ({
  createConfirmation: vi.fn(),
  consumeConfirmation: vi.fn(),
  consumeConfirmationInTx: vi.fn(),
}));
vi.mock("@/lib/jobs/queue", () => ({
  getSyncQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@/lib/jobs/maintenance-tasks", () => ({
  approveOwnPendingSenders: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
    emailConnection: { findFirst: vi.fn(), findMany: vi.fn() },
    sender: { findMany: vi.fn(), findFirst: vi.fn() },
    scheduledMessage: { findMany: vi.fn() },
    attachment: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    passkey: { findMany: vi.fn() },
    mcpToken: { findMany: vi.fn(), deleteMany: vi.fn() },
    mcpConfirmation: { create: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    contactGroup: { findMany: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

const PROTOCOL = "2026-07-28";

function jsonRpc(
  method: string,
  params?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL,
    "Mcp-Method": method,
    ...extraHeaders,
  };
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  });
}

async function mockAuthed() {
  const tokens = await import("@/lib/mcp/tokens");
  vi.mocked(tokens.verifyMcpAccessToken).mockResolvedValue({
    userId: "u1",
    tokenId: "t1",
  });
}

describe("MCP HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /mcp without auth returns 401 with resource metadata", async () => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(jsonRpc("server/discover"));
    expect(res.status).toBe(401);
    const www = res.headers.get("WWW-Authenticate") ?? "";
    expect(www).toContain("resource_metadata");
    expect(www).toContain("oauth-protected-resource");
  });

  it("authenticated server/discover and tools/list expose the mail catalog", async () => {
    await mockAuthed();
    const { POST } = await import("@/app/mcp/route");

    const discover = await POST(
      jsonRpc("server/discover", undefined, {
        Authorization: "Bearer tok",
      }),
    );
    expect(discover.status).toBe(200);
    expect(await discover.json()).toMatchObject({
      jsonrpc: "2.0",
      result: { capabilities: { tools: {} } },
    });

    const listed = await POST(
      jsonRpc("tools/list", undefined, {
        Authorization: "Bearer tok",
      }),
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    const names = (body.result.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    expect(names).toContain("list_mail");
    expect(names).toContain("send_mail");
    expect(names.some((name) => /wipe|admin/i.test(name))).toBe(false);
  });

  it("list_mail imbox returns 200 structured items", async () => {
    await mockAuthed();
    const { getMessages } = await import("@/lib/mail/messages");
    const { db } = await import("@/lib/db");
    vi.mocked(getMessages).mockResolvedValue({
      messages: [
        {
          id: "m1",
          threadId: "th1",
          fromAddress: "ada@example.com",
          fromName: "Ada",
          subject: "Hello",
          receivedAt: new Date("2026-08-14T12:00:00.000Z"),
          snippet: "Hi",
          isRead: false,
          isFlagged: false,
          hasAttachments: false,
          snoozedUntil: null,
          followUpAt: null,
          isFollowUp: false,
          sender: null,
          threadCount: 1,
        } as never,
      ],
      nextCursor: null,
    });
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        threadId: "th1",
        fromAddress: "ada@example.com",
        fromName: "Ada",
        toAddresses: ["bob@example.com"],
        subject: "Hello",
        receivedAt: new Date("2026-08-14T12:00:00.000Z"),
        snippet: "Hi",
        isRead: false,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        isInScreener: false,
        snoozedUntil: null,
        followUpAt: null,
        isReplyLater: false,
      },
    ] as never);

    const { POST } = await import("@/app/mcp/route");
    const res = await POST(
      jsonRpc(
        "tools/call",
        { name: "list_mail", arguments: { view: "imbox" } },
        { Authorization: "Bearer tok", "Mcp-Name": "list_mail" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.items).toEqual([
      expect.objectContaining({
        id: "m1",
        from: "Ada <ada@example.com>",
        subject: "Hello",
        isInImbox: true,
      }),
    ]);
  });

  it("GET /.well-known/oauth-protected-resource advertises /mcp", async () => {
    const { GET } =
      await import("@/app/.well-known/oauth-protected-resource/route");
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(String(body.resource)).toMatch(/\/mcp$/);
    expect(body.authorization_servers).toEqual(expect.any(Array));
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });

  it("GET /mcp returns 405", async () => {
    const { GET } = await import("@/app/mcp/route");
    const res = GET();
    expect(res.status).toBe(405);
  });
});
