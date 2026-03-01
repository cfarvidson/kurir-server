/**
 * Unit tests for the new auth helper functions in src/lib/auth.ts
 * Tests are written against the new API contract (post-redesign).
 *
 * Key helpers to test:
 * - getConnectionCredentials(connectionId) -- decrypts and returns creds
 * - getDefaultConnectionCredentials(userId) -- falls back correctly
 * - getUserEmailConnections(userId) -- ordering (default first)
 * - getEmailConnection(connectionId, userId) -- ownership check
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

// We test the credential-decryption logic in isolation by simulating
// the shape returned by db.emailConnection.findUnique.
// The db module is mocked since we don't have a real DB in unit tests.

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: {
    callbacks: {},
    pages: { signIn: "/login" },
    session: { strategy: "jwt" },
    providers: [],
  },
}));

describe("getConnectionCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns decrypted credentials for a valid connection", async () => {
    const { db } = await import("@/lib/db");
    const encryptedPassword = encrypt("app-password-123");

    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      email: "user@gmail.com",
      encryptedPassword,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
    } as any);

    const { getConnectionCredentials } = await import("@/lib/auth");
    const result = await getConnectionCredentials("conn-1");

    expect(result).not.toBeNull();
    expect(result!.email).toBe("user@gmail.com");
    expect(result!.password).toBe("app-password-123"); // decrypted
    expect(result!.imap.host).toBe("imap.gmail.com");
    expect(result!.imap.port).toBe(993);
    expect(result!.smtp.host).toBe("smtp.gmail.com");
    expect(result!.smtp.port).toBe(587);
  });

  it("returns null when connection does not exist", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const { getConnectionCredentials } = await import("@/lib/auth");
    const result = await getConnectionCredentials("non-existent");
    expect(result).toBeNull();
  });

  it("queries by connectionId", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const { getConnectionCredentials } = await import("@/lib/auth");
    await getConnectionCredentials("my-conn-id");

    expect(db.emailConnection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "my-conn-id" } })
    );
  });
});

describe("getDefaultConnectionCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns credentials including connectionId", async () => {
    const { db } = await import("@/lib/db");
    const encryptedPassword = encrypt("pass");

    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-default",
      email: "me@example.com",
      encryptedPassword,
      imapHost: "imap.example.com",
      imapPort: 993,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
    } as any);

    const { getDefaultConnectionCredentials } = await import("@/lib/auth");
    const result = await getDefaultConnectionCredentials("user-1");

    expect(result).not.toBeNull();
    expect(result!.connectionId).toBe("conn-default");
    expect(result!.email).toBe("me@example.com");
    expect(result!.password).toBe("pass");
  });

  it("returns null when user has no email connections", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const { getDefaultConnectionCredentials } = await import("@/lib/auth");
    const result = await getDefaultConnectionCredentials("user-no-connections");
    expect(result).toBeNull();
  });

  it("orders by isDefault desc then createdAt asc", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const { getDefaultConnectionCredentials } = await import("@/lib/auth");
    await getDefaultConnectionCredentials("user-1");

    expect(db.emailConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    );
  });
});

describe("getUserEmailConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns connections ordered default-first", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-1", email: "default@example.com", isDefault: true },
      { id: "conn-2", email: "other@example.com", isDefault: false },
    ] as any);

    const { getUserEmailConnections } = await import("@/lib/auth");
    const result = await getUserEmailConnections("user-1");

    expect(result).toHaveLength(2);
    expect(result[0].isDefault).toBe(true);
  });

  it("filters by userId", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([]);

    const { getUserEmailConnections } = await import("@/lib/auth");
    await getUserEmailConnections("user-123");

    expect(db.emailConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-123" } })
    );
  });
});

describe("getEmailConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns connection when it belongs to the user", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      userId: "user-1",
      email: "me@example.com",
    } as any);

    const { getEmailConnection } = await import("@/lib/auth");
    const result = await getEmailConnection("conn-1", "user-1");
    expect(result).not.toBeNull();
  });

  it("returns null when connection belongs to a different user", async () => {
    const { db } = await import("@/lib/db");
    // Simulates that findFirst returns null because the WHERE userId doesn't match
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const { getEmailConnection } = await import("@/lib/auth");
    const result = await getEmailConnection("conn-1", "attacker-user");
    expect(result).toBeNull();
  });

  it("queries with both connectionId and userId for ownership check", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const { getEmailConnection } = await import("@/lib/auth");
    await getEmailConnection("conn-42", "user-42");

    expect(db.emailConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conn-42", userId: "user-42" },
      })
    );
  });
});
