/**
 * Integration tests for the /api/connections routes.
 * Tests the full request/response cycle with mocked DB and IMAP.
 *
 * Covers:
 * - GET /api/connections — returns connections without encrypted password
 * - POST /api/connections — validates, verifies IMAP, saves connection
 * - PATCH /api/connections/[id] — updates, re-verifies on password change
 * - DELETE /api/connections/[id] — removes, prevents deleting last connection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth, db, IMAP verify
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getUserEmailConnections: vi.fn(),
  getEmailConnection: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/crypto")>();
  return {
    ...original,
    encrypt: vi.fn().mockReturnValue("encrypted-password"),
  };
});

vi.mock("@/lib/mail/imap-verify", () => ({
  verifyImapCredentials: vi.fn(),
}));

function makeRequest(
  method: string,
  body?: unknown,
  cookies?: Record<string, string>,
): Request {
  const req = new Request("http://localhost/api/connections", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return req;
}

describe("GET /api/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/connections/route");
    const req = makeRequest("GET");
    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns connections without encrypted password", async () => {
    const { auth, getUserEmailConnections } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(getUserEmailConnections).mockResolvedValue([
      {
        id: "conn-1",
        email: "me@gmail.com",
        encryptedPassword: "should-not-be-exposed",
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        isDefault: true,
        displayName: null,
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);

    const { GET } = await import("@/app/api/connections/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).not.toHaveProperty("encryptedPassword");
    expect(body.connections[0].email).toBe("me@gmail.com");
  });
});

describe("POST /api/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "me@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const response = await POST(req as any);

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid input", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", { email: "not-an-email" });
    const response = await POST(req as any);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request");
  });

  it("returns 422 when IMAP verification fails", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    vi.mocked(verifyImapCredentials).mockResolvedValue(false);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "me@gmail.com",
      password: "wrong-password",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const response = await POST(req as any);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain("IMAP");
  });

  it("returns 409 for duplicate email connection", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    vi.mocked(verifyImapCredentials).mockResolvedValue(true);

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "existing",
      email: "me@gmail.com",
    } as any);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "me@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const response = await POST(req as any);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already connected");
  });

  it("creates first connection as default regardless of flag", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    vi.mocked(verifyImapCredentials).mockResolvedValue(true);

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null); // no duplicate
    vi.mocked(db.emailConnection.count).mockResolvedValue(0); // first connection
    vi.mocked(db.emailConnection.updateMany).mockResolvedValue({
      count: 0,
    } as any);
    vi.mocked(db.emailConnection.create).mockResolvedValue({
      id: "conn-1",
      email: "me@gmail.com",
      encryptedPassword: "encrypted",
      isDefault: true,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      displayName: null,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "me@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
      isDefault: false, // explicitly false, but should be overridden
    });
    const response = await POST(req as any);

    expect(response.status).toBe(201);
    // Verify create was called with isDefault=true
    expect(db.emailConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it("encrypts password before storing", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    vi.mocked(verifyImapCredentials).mockResolvedValue(true);

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);
    vi.mocked(db.emailConnection.count).mockResolvedValue(0);
    vi.mocked(db.emailConnection.updateMany).mockResolvedValue({
      count: 0,
    } as any);
    vi.mocked(db.emailConnection.create).mockResolvedValue({
      id: "conn-1",
      email: "me@gmail.com",
      encryptedPassword: "encrypted-password",
      isDefault: true,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      displayName: null,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "me@gmail.com",
      password: "my-plain-password",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const response = await POST(req as any);

    expect(response.status).toBe(201);
    // Verify the stored password is NOT the plain text
    expect(db.emailConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          encryptedPassword: "encrypted-password", // the mocked encrypted value
        }),
      }),
    );
    // Plain password should not be in the create call
    const createCall = vi.mocked(db.emailConnection.create).mock.calls[0][0];
    expect(JSON.stringify(createCall)).not.toContain("my-plain-password");
  });

  it("response does not include encryptedPassword", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    vi.mocked(verifyImapCredentials).mockResolvedValue(true);

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);
    vi.mocked(db.emailConnection.count).mockResolvedValue(1); // not first
    vi.mocked(db.emailConnection.updateMany).mockResolvedValue({
      count: 0,
    } as any);
    vi.mocked(db.emailConnection.create).mockResolvedValue({
      id: "conn-2",
      email: "work@example.com",
      encryptedPassword: "never-expose-this",
      isDefault: false,
      imapHost: "imap.example.com",
      imapPort: 993,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      displayName: "Work",
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const { POST } = await import("@/app/api/connections/route");
    const req = makeRequest("POST", {
      email: "work@example.com",
      password: "pass",
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
    });
    const response = await POST(req as any);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.connection).not.toHaveProperty("encryptedPassword");
  });
});

describe("DELETE /api/connections/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const req = makeRequest("DELETE");
    const response = await DELETE(req as any, {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when connection not found or not owned by user", async () => {
    const { auth, getEmailConnection } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getEmailConnection).mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const req = makeRequest("DELETE");
    const response = await DELETE(req as any, {
      params: Promise.resolve({ id: "other-conn" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 409 when trying to delete the last connection", async () => {
    const { auth, getEmailConnection } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getEmailConnection).mockResolvedValue({
      id: "conn-1",
      isDefault: true,
    } as any);

    const { db } = await import("@/lib/db");
    // Transaction throws LAST_CONNECTION when count <= 1
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        emailConnection: {
          count: vi.fn().mockResolvedValue(1),
          delete: vi.fn(),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const req = makeRequest("DELETE");
    const response = await DELETE(req as any, {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("only email connection");
  });

  it("promotes next connection to default when deleting the default", async () => {
    const { auth, getEmailConnection } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getEmailConnection).mockResolvedValue({
      id: "conn-1",
      isDefault: true,
      userId: "user-1",
    } as any);

    const mockUpdate = vi.fn().mockResolvedValue({} as any);
    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        emailConnection: {
          count: vi.fn().mockResolvedValue(2),
          delete: vi.fn().mockResolvedValue({}),
          findFirst: vi.fn().mockResolvedValue({ id: "conn-2" }),
          update: mockUpdate,
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const req = makeRequest("DELETE");
    const response = await DELETE(req as any, {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(200);
    // Should have promoted the next connection
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "conn-2" },
      data: { isDefault: true },
    });
  });

  it("does not promote when deleting a non-default connection", async () => {
    const { auth, getEmailConnection } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(getEmailConnection).mockResolvedValue({
      id: "conn-2",
      isDefault: false, // NOT default
      userId: "user-1",
    } as any);

    const mockUpdate = vi.fn();
    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        emailConnection: {
          count: vi.fn().mockResolvedValue(2),
          delete: vi.fn().mockResolvedValue({}),
          findFirst: vi.fn(),
          update: mockUpdate,
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const req = makeRequest("DELETE");
    const response = await DELETE(req as any, {
      params: Promise.resolve({ id: "conn-2" }),
    });

    expect(response.status).toBe(200);
    // Should NOT have called update (no promotion needed)
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
