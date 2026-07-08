import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    scheduledMessage: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/crypto", () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/mail/scheduled-send", () => ({ sendScheduledEmail: vi.fn() }));
vi.mock("@/lib/mail/persist-sent", () => ({ createLocalSentMessage: vi.fn() }));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitSend: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  };
});

// holdScheduledMessage / restoreScheduledMessage are the atomic compare-and-set
// gates that close the scheduled-message double-send race (issue #52). They must
// flip status only when the row is in the expected state, report success via a
// boolean (never throw on a lost race), and enforce userId ownership.
describe("hold/restore scheduled message actions", () => {
  beforeEach(() => vi.clearAllMocks());

  async function authedUser(id = "user-1") {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id } } as never);
  }

  async function lastUpdateManyArgs() {
    const { db } = await import("@/lib/db");
    return vi.mocked(db.scheduledMessage.updateMany).mock.calls[0][0];
  }

  describe("holdScheduledMessage", () => {
    it("flips PENDING → CANCELLED, gated on userId, and reports held", async () => {
      await authedUser("user-1");
      const { db } = await import("@/lib/db");
      const { updateTag } = await import("next/cache");
      vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { holdScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      const result = await holdScheduledMessage("sched-1");

      expect(result).toEqual({ held: true });
      const args = await lastUpdateManyArgs();
      expect(args.where).toEqual({
        id: "sched-1",
        userId: "user-1",
        status: "PENDING",
      });
      expect(args.data).toEqual({ status: "CANCELLED" });
      expect(updateTag).toHaveBeenCalledWith("sidebar-counts");
    });

    it("returns held:false without throwing when the row is no longer PENDING (scheduler won the race)", async () => {
      await authedUser();
      const { db } = await import("@/lib/db");
      const { updateTag } = await import("next/cache");
      vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      const { holdScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      const result = await holdScheduledMessage("sched-1");

      expect(result).toEqual({ held: false });
      expect(updateTag).not.toHaveBeenCalled();
    });

    it("throws Unauthorized and never touches the DB when unauthenticated", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth).mockResolvedValue(null as never);
      const { db } = await import("@/lib/db");

      const { holdScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      await expect(holdScheduledMessage("sched-1")).rejects.toThrow(
        "Unauthorized",
      );
      expect(db.scheduledMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("restoreScheduledMessage", () => {
    it("flips CANCELLED → PENDING, gated on userId, and reports restored", async () => {
      await authedUser("user-1");
      const { db } = await import("@/lib/db");
      const { updateTag } = await import("next/cache");
      vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { restoreScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      const result = await restoreScheduledMessage("sched-1");

      expect(result).toEqual({ restored: true });
      const args = await lastUpdateManyArgs();
      expect(args.where).toEqual({
        id: "sched-1",
        userId: "user-1",
        status: "CANCELLED",
      });
      expect(args.data).toEqual({ status: "PENDING" });
      expect(updateTag).toHaveBeenCalledWith("sidebar-counts");
    });

    it("returns restored:false without throwing when the row isn't restorable (already sent)", async () => {
      await authedUser();
      const { db } = await import("@/lib/db");
      const { updateTag } = await import("next/cache");
      vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      const { restoreScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      const result = await restoreScheduledMessage("sched-1");

      expect(result).toEqual({ restored: false });
      expect(updateTag).not.toHaveBeenCalled();
    });

    it("throws Unauthorized and never touches the DB when unauthenticated", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth).mockResolvedValue(null as never);
      const { db } = await import("@/lib/db");

      const { restoreScheduledMessage } = await import(
        "@/actions/scheduled-messages"
      );
      await expect(restoreScheduledMessage("sched-1")).rejects.toThrow(
        "Unauthorized",
      );
      expect(db.scheduledMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("sendScheduledMessageNow", () => {
    it("rejects and leaves the message unsent when the send rate limit is exceeded", async () => {
      await authedUser("user-1");
      const { db } = await import("@/lib/db");
      vi.mocked(db.scheduledMessage.updateMany).mockResolvedValue({
        count: 1,
      } as never);
      vi.mocked(db.scheduledMessage.findUnique).mockResolvedValue({
        id: "sched-1",
        smtpMessageId: null,
        emailConnectionId: "conn-1",
        emailConnection: { email: "me@example.com", sendAsEmail: null },
      } as never);

      const { rateLimitSend } = await import("@/lib/rate-limit");
      vi.mocked(rateLimitSend).mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfter: 42,
      });

      const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");

      const { sendScheduledMessageNow } = await import(
        "@/actions/scheduled-messages"
      );
      await expect(sendScheduledMessageNow("sched-1")).rejects.toThrow(
        /Too many messages/,
      );

      expect(sendScheduledEmail).not.toHaveBeenCalled();
      // Rolled back to PENDING, not marked SENT.
      expect(db.scheduledMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );
      expect(db.scheduledMessage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SENT" }),
        }),
      );
    });
  });
});
