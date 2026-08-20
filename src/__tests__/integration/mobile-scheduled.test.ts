/**
 * Integration tests for /api/mobile/scheduled — the mobile surface over the
 * shared scheduled-message cores. Auth, the shared zod schema (jitter, future
 * enforcement), per-user list scoping, cancel semantics (404 vs 409) and the
 * send-now path. The db is mocked so the cores' real ownership/CAS logic runs
 * against controllable data; the SMTP transport is mocked at `sendScheduledEmail`
 * exactly as the existing scheduled-message tests do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findFirst: vi.fn() },
    attachment: { count: vi.fn() },
    message: { findFirst: vi.fn() },
    scheduledMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, "")),
}));

// The real updateTag THROWS outside a Server Action (i.e. in these route
// handlers) — mirror that here so any shared core reached from the mobile
// routes that touches the cache layer fails the suite. Regression: the
// scheduled cores called updateTag and 400'd every mobile request in prod
// after the row had already been written.
vi.mock("next/cache", () => ({
  updateTag: vi.fn(() => {
    throw new Error(
      "updateTag can only be called from within a Server Action",
    );
  }),
}));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/mail/scheduled-send", () => ({
  sendScheduledEmail: vi.fn(),
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn(),
  appendToImapSent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mail/attachment-helpers", () => ({
  loadAttachmentsForSend: vi.fn().mockResolvedValue({
    nodemailerAttachments: [],
    sentAttachments: [],
    ids: [],
  }),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
    rateLimitSend: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  };
});

function makeRequest(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as never;
}

async function mockAuthed(userId = "user-1") {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId });
}

async function mockUnauthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue(null);
}

describe("/api/mobile/scheduled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(a) POST without bearer auth returns 401", async () => {
    await mockUnauthed();
    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "a@x.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("(b) POST creates a PENDING row with jitter (scheduledFor >= requested + 60s) and returns the server's time", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
    } as never);
    // The core computes the jittered time itself and returns it; the create
    // return only needs an id.
    vi.mocked(db.scheduledMessage.create).mockResolvedValue({
      id: "sched-1",
    } as never);

    const requested = new Date(Date.now() + 3_600_000);
    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "recipient@example.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: requested.toISOString(),
        emailConnectionId: "conn-1",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("sched-1");

    // The persisted time carries 1–14 min of jitter on top of the request.
    const createArgs = vi.mocked(db.scheduledMessage.create).mock
      .calls[0][0] as { data: { scheduledFor: Date; textBody: string } };
    const persisted = createArgs.data.scheduledFor.getTime();
    expect(persisted).toBeGreaterThanOrEqual(requested.getTime() + 60_000);
    expect(persisted).toBeLessThanOrEqual(requested.getTime() + 14 * 60_000);
    // Body is encrypted at rest (encrypt mock prefixes "enc:").
    expect(createArgs.data.textBody).toBe("enc:hello");
    // Response echoes the server's jittered time, not the client's guess.
    expect(new Date(json.scheduledFor).getTime()).toBe(persisted);
  });

  it("(b2) POST with cc/bcc stores the normalized fields on the row", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
    } as never);
    vi.mocked(db.scheduledMessage.create).mockResolvedValue({
      id: "sched-1",
    } as never);

    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "recipient@example.com",
        cc: "cc1@example.com; cc2@example.com",
        bcc: "hidden@example.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );

    expect(res.status).toBe(200);
    const createArgs = vi.mocked(db.scheduledMessage.create).mock
      .calls[0][0] as { data: { cc: string | null; bcc: string | null } };
    // Semicolon-separated input is normalized to a comma-joined list.
    expect(createArgs.data.cc).toBe("cc1@example.com, cc2@example.com");
    expect(createArgs.data.bcc).toBe("hidden@example.com");
  });

  it("(b3) POST without cc/bcc stores NULL for both (no regression)", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
    } as never);
    vi.mocked(db.scheduledMessage.create).mockResolvedValue({
      id: "sched-1",
    } as never);

    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "recipient@example.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );

    expect(res.status).toBe(200);
    const createArgs = vi.mocked(db.scheduledMessage.create).mock
      .calls[0][0] as { data: { cc: string | null; bcc: string | null } };
    expect(createArgs.data.cc).toBeNull();
    expect(createArgs.data.bcc).toBeNull();
  });

  it("(b5) POST with only Cc (no To) creates the row with to = \"\"", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
    } as never);
    vi.mocked(db.scheduledMessage.create).mockResolvedValue({
      id: "sched-1",
    } as never);

    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        cc: "cc-only@example.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );

    expect(res.status).toBe(200);
    const createArgs = vi.mocked(db.scheduledMessage.create).mock
      .calls[0][0] as { data: { to: string; cc: string | null } };
    expect(createArgs.data.to).toBe("");
    expect(createArgs.data.cc).toBe("cc-only@example.com");
  });

  it("(b6) POST with no recipient in any field returns 400 and never creates a row", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );
    expect(res.status).toBe(400);
    expect(db.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it("(b4) POST with an invalid cc address returns 400 and never creates a row", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "recipient@example.com",
        cc: "not-an-address",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );
    expect(res.status).toBe(400);
    expect(db.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it("(c) POST with a past scheduledFor returns 400 and never creates a row", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/mobile/scheduled/route");
    const res = await POST(
      makeRequest({
        to: "recipient@example.com",
        subject: "Hi",
        textBody: "hello",
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
        emailConnectionId: "conn-1",
      }),
    );
    expect(res.status).toBe(400);
    expect(db.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it("(d) GET lists only the authed user's PENDING/SENDING/FAILED rows, soonest first", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.scheduledMessage.findMany).mockResolvedValue([
      {
        id: "s1",
        to: "a@x.com",
        subject: "S",
        scheduledFor: new Date("2026-07-25T09:00:00.000Z"),
        status: "PENDING",
        error: null,
      },
    ] as never);

    const { GET } = await import("@/app/api/mobile/scheduled/route");
    const res = await GET(makeRequest(undefined));

    expect(res.status).toBe(200);
    expect(db.scheduledMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          status: { in: ["PENDING", "SENDING", "FAILED"] },
        },
        orderBy: { scheduledFor: "asc" },
      }),
    );
    const json = await res.json();
    expect(json.scheduled).toHaveLength(1);
    expect(json.scheduled[0].id).toBe("s1");
  });

  it("(e) DELETE cancels a PENDING message", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue({
      status: "PENDING",
    } as never);
    vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const { DELETE } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await DELETE(makeRequest(undefined), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.scheduledMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: "user-1", status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  });

  it("(f) DELETE on an already-SENT message returns 409 and never writes", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue({
      status: "SENT",
    } as never);

    const { DELETE } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await DELETE(makeRequest(undefined), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(409);
    expect(db.scheduledMessage.updateMany).not.toHaveBeenCalled();
  });

  it("(g) DELETE of another user's (or missing) id returns 404", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    // findFirst is scoped to { id, userId }, so a foreign row reads as null.
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue(null as never);

    const { DELETE } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await DELETE(makeRequest(undefined), {
      params: Promise.resolve({ id: "not-mine" }),
    });

    expect(res.status).toBe(404);
    expect(db.scheduledMessage.updateMany).not.toHaveBeenCalled();
  });

  it("(h) POST { action: sendNow } claims the row and drives it to SENT", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    // CAS claim PENDING -> SENDING succeeds.
    vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    vi.mocked(db.scheduledMessage.findUnique).mockResolvedValue({
      id: "s1",
      userId: "user-1",
      emailConnectionId: "conn-1",
      smtpMessageId: null,
      to: "recipient@example.com",
      subject: "Hi",
      textBody: "enc:hello",
      htmlBody: null,
      inReplyToMessageId: null,
      references: null,
      emailConnection: { email: "me@example.com", sendAsEmail: null },
    } as never);

    const { getConnectionCredentialsInternal } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentialsInternal).mockResolvedValue({
      email: "me@example.com",
    } as never);

    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    vi.mocked(sendScheduledEmail).mockResolvedValue({
      messageId: "<sent@example.com>",
    } as never);

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");

    const { POST } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await POST(makeRequest({ action: "sendNow" }), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sendScheduledEmail).toHaveBeenCalledTimes(1);
    expect(createLocalSentMessage).toHaveBeenCalledTimes(1);
    // Row driven to SENT with the SMTP id recorded.
    expect(db.scheduledMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
  });

  it("(h2) POST { action: sendNow } on a row that is no longer PENDING returns 409", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    // CAS claim fails — the scheduler already took it.
    vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    const { POST } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await POST(makeRequest({ action: "sendNow" }), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(409);
  });

  it("(i) PATCH without bearer auth returns 401", async () => {
    await mockUnauthed();
    const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await PATCH(makeRequest({}), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(401);
  });

  it("(j) PATCH updates a PENDING row through the shared edit core", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    const existingScheduledFor = new Date("2026-08-21T10:00:00.000Z");
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue({
      id: "s1",
      userId: "user-1",
      status: "PENDING",
      emailConnectionId: "conn-1",
      to: "old@example.com",
      cc: null,
      bcc: null,
      scheduledFor: existingScheduledFor,
    } as never);
    vi.mocked(db.scheduledMessage.update).mockResolvedValue({} as never);

    const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await PATCH(
      makeRequest({
        subject: "Updated",
        textBody: "new body",
      }),
      { params: Promise.resolve({ id: "s1" }) },
    );

    expect(res.status).toBe(200);
    expect(db.scheduledMessage.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", userId: "user-1" },
    });
    const updateArgs = vi.mocked(db.scheduledMessage.update).mock.calls[0][0] as {
      where: { id: string };
      data: { subject: string; textBody: string };
    };
    expect(updateArgs.where).toEqual({ id: "s1" });
    expect(updateArgs.data.subject).toBe("Updated");
    expect(updateArgs.data.textBody).toBe("enc:new body");
    const json = await res.json();
    expect(json.id).toBe("s1");
    expect(new Date(json.scheduledFor).getTime()).toBe(
      existingScheduledFor.getTime(),
    );
  });

  it("(k) PATCH of another user's (or missing) id returns 404", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue(null as never);

    const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await PATCH(makeRequest({ subject: "X" }), {
      params: Promise.resolve({ id: "not-mine" }),
    });

    expect(res.status).toBe(404);
    expect(db.scheduledMessage.update).not.toHaveBeenCalled();
  });

  it("(l) PATCH on an already-SENT message returns 409 and never writes", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.scheduledMessage.findFirst).mockResolvedValue({
      status: "SENT",
    } as never);

    const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await PATCH(makeRequest({ subject: "X" }), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(409);
    expect(db.scheduledMessage.update).not.toHaveBeenCalled();
  });

  it("(m) PATCH with a past scheduledFor returns 400 and never writes", async () => {
    await mockAuthed("user-1");
    const { db } = await import("@/lib/db");
    const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
    const res = await PATCH(
      makeRequest({
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      }),
      { params: Promise.resolve({ id: "s1" }) },
    );

    expect(res.status).toBe(400);
    expect(db.scheduledMessage.findFirst).not.toHaveBeenCalled();
    expect(db.scheduledMessage.update).not.toHaveBeenCalled();
  });
});
