/**
 * On-demand IMAP new-mail check (kurir-server#161).
 *
 * Cheap lastUid catch-up, not a full folder resync. In-flight calls for the
 * same user join rather than opening a second IMAP round-trip. Rate limit is
 * 1 successful check per 5 seconds; overlapping joins skip the limiter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/mail/connection-manager", () => ({
  connectionManager: {
    startConnection: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/mail/idle-handlers", () => ({
  checkForNewMessages: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitCheck: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 }),
  };
});

const USER = "user-1";

async function load() {
  return import("@/lib/mail/check-new-mail");
}

describe("checkNewMailForUser", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const { rateLimitCheck } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitCheck).mockResolvedValue({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
    });
  });

  it("ingests new UIDs across the user's connections", async () => {
    const { db } = await import("@/lib/db");
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    const { checkForNewMessages } = await import("@/lib/mail/idle-handlers");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-a" },
      { id: "conn-b" },
    ] as never);
    vi.mocked(checkForNewMessages)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const { checkNewMailForUser } = await load();
    const result = await checkNewMailForUser(USER);

    expect(result).toEqual({ status: "ok", ingested: 3 });
    expect(connectionManager.startConnection).toHaveBeenCalledWith("conn-a");
    expect(connectionManager.startConnection).toHaveBeenCalledWith("conn-b");
    expect(checkForNewMessages).toHaveBeenCalledWith("conn-a");
    expect(checkForNewMessages).toHaveBeenCalledWith("conn-b");
  });

  it("is a no-op when nothing new is on IMAP", async () => {
    const { db } = await import("@/lib/db");
    const { checkForNewMessages } = await import("@/lib/mail/idle-handlers");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-a" },
    ] as never);
    vi.mocked(checkForNewMessages).mockResolvedValue(0);

    const { checkNewMailForUser } = await load();
    expect(await checkNewMailForUser(USER)).toEqual({
      status: "ok",
      ingested: 0,
    });
  });

  it("joins an in-flight check instead of a second IMAP round-trip", async () => {
    const { db } = await import("@/lib/db");
    const { checkForNewMessages } = await import("@/lib/mail/idle-handlers");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-a" },
    ] as never);

    let release!: (n: number) => void;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });
    vi.mocked(checkForNewMessages).mockImplementation(() => gate);

    const { checkNewMailForUser } = await load();
    const first = checkNewMailForUser(USER);
    await vi.waitFor(() =>
      expect(checkForNewMessages).toHaveBeenCalledTimes(1),
    );
    const second = checkNewMailForUser(USER);

    release(4);
    await expect(first).resolves.toEqual({ status: "ok", ingested: 4 });
    await expect(second).resolves.toEqual({ status: "ok", ingested: 4 });
    expect(checkForNewMessages).toHaveBeenCalledTimes(1);
  });

  it("returns rate_limited after a completed check inside the window", async () => {
    const { db } = await import("@/lib/db");
    const { checkForNewMessages } = await import("@/lib/mail/idle-handlers");
    const { rateLimitCheck } = await import("@/lib/rate-limit");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "conn-a" },
    ] as never);
    vi.mocked(checkForNewMessages).mockResolvedValue(0);
    vi.mocked(rateLimitCheck)
      .mockResolvedValueOnce({ allowed: true, remaining: 0, retryAfter: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 4 });

    const { checkNewMailForUser } = await load();
    expect(await checkNewMailForUser(USER)).toEqual({
      status: "ok",
      ingested: 0,
    });
    expect(await checkNewMailForUser(USER)).toEqual({
      status: "rate_limited",
      retryAfter: 4,
    });
    expect(checkForNewMessages).toHaveBeenCalledTimes(1);
  });
});
