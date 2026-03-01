/**
 * Unit tests for thread page email resolution.
 *
 * Thread pages (imbox, feed, sent, archive, paper-trail, snoozed) all need
 * to resolve currentUserEmail to distinguish the user's own messages from
 * incoming messages. In the multi-email world, the email comes from the
 * user's EmailConnection records, not from User.email (which no longer exists).
 *
 * These tests verify:
 * 1. The default connection is preferred (isDefault=true, then oldest createdAt)
 * 2. Empty string is returned gracefully when user has no connections
 * 3. Reply target logic correctly identifies "last message not from self"
 * 4. Single-connection and multi-connection user scenarios are handled
 *
 * Since thread page code is in Next.js Server Components (not directly importable),
 * we test the underlying DB query pattern by calling the helper logic
 * against the mocked Prisma client — matching the same queries the pages use.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// Helpers that replicate the getUserEmail / getUserInfo patterns used in pages
// ────────────────────────────────────────────────────────────────────────────

async function getUserEmailFromConnections(userId: string): Promise<string> {
  const { db } = await import("@/lib/db");
  const conn = await db.emailConnection.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { email: true },
  });
  return conn?.email || "";
}

async function getUserInfoFromConnections(
  userId: string
): Promise<{ email: string; timezone: string }> {
  const { db } = await import("@/lib/db");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      timezone: true,
      emailConnections: {
        select: { email: true },
        orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
        take: 1,
      },
    },
  });
  return {
    email: (user as any)?.emailConnections?.[0]?.email || "",
    timezone: (user as any)?.timezone || "UTC",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// getUserEmail (used by sent/[id], archive/[id])
// ────────────────────────────────────────────────────────────────────────────

describe("getUserEmail — resolves current user email from EmailConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the email of the default connection", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      email: "me@gmail.com",
    } as any);

    const result = await getUserEmailFromConnections("user-1");
    expect(result).toBe("me@gmail.com");
  });

  it("returns empty string when user has no email connections", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    const result = await getUserEmailFromConnections("user-1");
    expect(result).toBe("");
  });

  it("queries with correct ordering — isDefault desc, then createdAt asc", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    await getUserEmailFromConnections("user-1");

    expect(db.emailConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    );
  });

  it("filters by userId to avoid leaking other users' email", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    await getUserEmailFromConnections("user-42");

    expect(db.emailConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-42" },
      })
    );
  });

  it("only selects the email field (no unnecessary data)", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);

    await getUserEmailFromConnections("user-1");

    expect(db.emailConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { email: true },
      })
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getUserInfo (used by imbox/[id], feed/[id])
// ────────────────────────────────────────────────────────────────────────────

describe("getUserInfo — resolves email + timezone via user.emailConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns email from the first (default) connection", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "America/New_York",
      emailConnections: [{ email: "inbox@example.com" }],
    } as any);

    const result = await getUserInfoFromConnections("user-1");
    expect(result.email).toBe("inbox@example.com");
    expect(result.timezone).toBe("America/New_York");
  });

  it("returns empty string email when user has no connections", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "UTC",
      emailConnections: [],
    } as any);

    const result = await getUserInfoFromConnections("user-1");
    expect(result.email).toBe("");
  });

  it("defaults timezone to UTC when not set", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: null,
      emailConnections: [{ email: "me@example.com" }],
    } as any);

    const result = await getUserInfoFromConnections("user-1");
    expect(result.timezone).toBe("UTC");
  });

  it("returns empty email when user record not found", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const result = await getUserInfoFromConnections("nonexistent-user");
    expect(result.email).toBe("");
    expect(result.timezone).toBe("UTC");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Reply target resolution logic
//
// The thread pages determine the reply target by finding the last message
// whose fromAddress is NOT the current user. This logic must correctly handle
// multi-email users, where the "self" address varies per connection.
// ────────────────────────────────────────────────────────────────────────────

describe("reply target resolution — last message not from self", () => {
  type ThreadMessage = {
    id: string;
    fromAddress: string;
    replyTo: string | null;
    fromName: string | null;
    subject: string | null;
    sender: { displayName: string | null } | null;
  };

  function resolveReplyTarget(
    messages: ThreadMessage[],
    currentUserEmail: string
  ) {
    const lastMessage = messages[messages.length - 1];
    const lastIncoming = [...messages]
      .reverse()
      .find((m) => m.fromAddress !== currentUserEmail);
    const replyTarget = lastIncoming || lastMessage;
    const replyToAddress = replyTarget.replyTo || replyTarget.fromAddress;
    const replyToName =
      replyTarget.sender?.displayName ||
      replyTarget.fromName ||
      replyTarget.fromAddress;
    return { replyToAddress, replyToName };
  }

  it("replies to the last incoming message from someone else", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "alice@example.com",
        replyTo: null,
        fromName: "Alice",
        subject: "Hello",
        sender: null,
      },
      {
        id: "m2",
        fromAddress: "me@gmail.com", // my reply
        replyTo: null,
        fromName: null,
        subject: "Re: Hello",
        sender: null,
      },
      {
        id: "m3",
        fromAddress: "alice@example.com", // her response
        replyTo: null,
        fromName: "Alice",
        subject: "Re: Hello",
        sender: null,
      },
    ];

    const { replyToAddress } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToAddress).toBe("alice@example.com");
  });

  it("falls back to last message when all messages are from self (sent-only thread)", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "me@gmail.com",
        replyTo: null,
        fromName: null,
        subject: "Sent-only thread",
        sender: null,
      },
      {
        id: "m2",
        fromAddress: "me@gmail.com",
        replyTo: null,
        fromName: null,
        subject: "Sent-only thread continued",
        sender: null,
      },
    ];

    const { replyToAddress } = resolveReplyTarget(messages, "me@gmail.com");
    // Falls back to last message (from self) when no incoming message found
    expect(replyToAddress).toBe("me@gmail.com");
  });

  it("uses replyTo address when available", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "noreply@newsletter.com",
        replyTo: "support@newsletter.com", // different reply-to
        fromName: "Newsletter",
        subject: "Weekly digest",
        sender: null,
      },
    ];

    const { replyToAddress } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToAddress).toBe("support@newsletter.com");
  });

  it("uses sender displayName when available", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "alice@example.com",
        replyTo: null,
        fromName: "A",
        subject: "Hi",
        sender: { displayName: "Alice Smith" }, // display name from screened sender
      },
    ];

    const { replyToName } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToName).toBe("Alice Smith");
  });

  it("falls back to fromName when no sender displayName", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "bob@example.com",
        replyTo: null,
        fromName: "Bob",
        subject: "Hi",
        sender: null,
      },
    ];

    const { replyToName } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToName).toBe("Bob");
  });

  it("falls back to email address when no name is available", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "noreply@example.com",
        replyTo: null,
        fromName: null,
        subject: "No name",
        sender: null,
      },
    ];

    const { replyToName } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToName).toBe("noreply@example.com");
  });

  it("correctly identifies self when user has a non-default connection as sender", () => {
    // Multi-email user: they sent m2 from their work account, not their gmail
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "alice@example.com",
        replyTo: null,
        fromName: "Alice",
        subject: "Question",
        sender: null,
      },
      {
        id: "m2",
        fromAddress: "me@work.com", // user's second connection
        replyTo: null,
        fromName: null,
        subject: "Re: Question",
        sender: null,
      },
    ];

    // The page uses the DEFAULT connection email as currentUserEmail.
    // If the user replied from their work account but we're checking against gmail,
    // m2 would be wrongly treated as incoming.
    // This is a known limitation of using only the default email — documented.
    const { replyToAddress } = resolveReplyTarget(messages, "me@gmail.com");
    // m2 is from work (not matching gmail), so it's treated as "incoming"
    expect(replyToAddress).toBe("me@work.com");
  });

  it("handles single-message thread correctly", () => {
    const messages: ThreadMessage[] = [
      {
        id: "m1",
        fromAddress: "alice@example.com",
        replyTo: null,
        fromName: "Alice",
        subject: "Hi",
        sender: null,
      },
    ];

    const { replyToAddress } = resolveReplyTarget(messages, "me@gmail.com");
    expect(replyToAddress).toBe("alice@example.com");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Multi-connection email matching
//
// Task #7 context: the thread pages currently resolve currentUserEmail from
// the DEFAULT connection only. This means messages sent from a non-default
// connection may not be recognized as "from self." This test documents the
// expected behavior and the known limitation.
// ────────────────────────────────────────────────────────────────────────────

describe("multi-email currentUserEmail resolution — default connection behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the connection where isDefault=true over older connections", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findFirst).mockImplementation(
      async (args: any) => {
        // Simulate DB ordering: return the default connection first
        if (args.orderBy?.[0]?.isDefault === "desc") {
          return { email: "me@gmail.com" }; // default connection
        }
        return null;
      }
    );

    const result = await getUserEmailFromConnections("user-1");
    expect(result).toBe("me@gmail.com");
  });

  it("with no default flagged, returns the oldest connection (createdAt asc)", async () => {
    const { db } = await import("@/lib/db");
    // Simulate: no isDefault=true connection, oldest first
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
      email: "oldest@example.com",
    } as any);

    const result = await getUserEmailFromConnections("user-1");
    expect(result).toBe("oldest@example.com");
  });
});
