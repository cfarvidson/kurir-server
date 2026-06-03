/**
 * Unit tests for POST /api/mail/send.
 * Verifies that send picks the correct connection (specified or default),
 * and passes emailConnectionId to createLocalSentMessage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getConnectionCredentials: vi.fn(),
  getDefaultConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findFirst: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn().mockResolvedValue({ id: "sent-1" }),
  appendToImapSent: vi.fn().mockResolvedValue(undefined),
}));

const mockSendMail = vi
  .fn()
  .mockResolvedValue({ messageId: "<sent@example.com>" });
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: mockSendMail,
    }),
  },
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mail/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({ to: "someone@example.com" });
    const response = await POST(req);

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid email address", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({ to: "not-an-email" });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid recipient address");
    expect(body.error).toContain("not-an-email");
  });

  it("rejects the whole send when any recipient in a list is invalid", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({ to: "good@example.com, not-an-email" });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not-an-email");
    // Must not attempt a partial send.
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(getDefaultConnectionCredentials).not.toHaveBeenCalled();
  });

  it("sends to multiple recipients as a list", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
      connectionId: "conn-default",
      email: "me@gmail.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "a@example.com, b@example.com",
      subject: "Hi",
      text: "Hello",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["a@example.com", "b@example.com"] }),
    );
    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        toAddresses: ["a@example.com", "b@example.com"],
      }),
    );
  });

  it("threads cc and bcc into sendMail and the persisted message", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
      connectionId: "conn-default",
      email: "me@gmail.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "a@example.com",
      cc: "c@example.com, d@example.com",
      bcc: "e@example.com",
      subject: "Hi",
      text: "Hello",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["a@example.com"],
        cc: "c@example.com, d@example.com",
        bcc: "e@example.com",
      }),
    );
    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ccAddresses: ["c@example.com", "d@example.com"],
        bccAddresses: ["e@example.com"],
      }),
    );
  });

  it("returns 400 when a cc address is invalid and does not send", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "a@example.com",
      cc: "not-an-email",
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not-an-email");
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(getDefaultConnectionCredentials).not.toHaveBeenCalled();
  });

  it("allows a Bcc-only send with an empty To (group-only case)", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
      connectionId: "conn-default",
      email: "me@gmail.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "",
      bcc: "e@example.com",
      subject: "Announcement",
      text: "Hello",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const sendArg = mockSendMail.mock.calls[0][0];
    expect(sendArg.to).toBeUndefined();
    expect(sendArg.bcc).toBe("e@example.com");
  });

  it("returns 400 when no recipient is provided in any field", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({ to: "", cc: "", bcc: "" });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No valid recipient");
    expect(getDefaultConnectionCredentials).not.toHaveBeenCalled();
  });

  it("uses the default connection when fromConnectionId is not specified", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
      connectionId: "conn-default",
      email: "me@gmail.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "someone@example.com",
      subject: "Hi",
      text: "Hello",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(getDefaultConnectionCredentials).toHaveBeenCalledWith("user-1");
  });

  it("returns 400 when user has no email connections", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({ to: "someone@example.com" });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("No email connection");
  });

  it("uses the specified fromConnectionId when provided", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    // Connection ownership check
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-work",
    } as any);

    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@work.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.work.com", port: 993 },
      smtp: { host: "smtp.work.com", port: 587 },
    });

    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "someone@example.com",
      subject: "Hi from work",
      text: "Hello",
      fromConnectionId: "conn-work",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(getConnectionCredentials).toHaveBeenCalledWith(
      "conn-work",
      "user-1",
    );

    // Should send from the work account
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "me@work.com" }),
    );
  });

  it("returns 404 when specified fromConnectionId doesn't belong to user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    // Ownership check fails
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "someone@example.com",
      fromConnectionId: "conn-other-user",
    });
    const response = await POST(req);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("passes emailConnectionId to createLocalSentMessage", async () => {
    const { auth, getDefaultConnectionCredentials } =
      await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
      connectionId: "conn-personal",
      email: "me@personal.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.personal.com", port: 993 },
      smtp: { host: "smtp.personal.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    const { POST } = await import("@/app/api/mail/send/route");
    const req = makeRequest({
      to: "recipient@example.com",
      subject: "Test",
      text: "Body",
    });
    await POST(req);

    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        emailConnectionId: "conn-personal",
        userId: "user-1",
        fromAddress: "me@personal.com",
      }),
    );
  });
});
