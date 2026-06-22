import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findMany: vi.fn() },
    sender: { count: vi.fn() },
    message: { count: vi.fn() },
    scheduledMessage: { count: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { computeSidebarCounts } from "@/lib/mail/sidebar-counts";
import { db } from "@/lib/db";

/**
 * computeSidebarCounts issues, in order: sender.count (screener), then five
 * message.count calls (imbox, follow-up, reply-later, feed, paper-trail),
 * scheduledMessage.count, and user.findUnique (badge prefs) — all inside one
 * Promise.all, so message.count resolves in declaration order.
 */
function seedCounts({
  screener = 0,
  imbox = 0,
  followUp = 0,
  replyLater = 0,
  feed = 0,
  paperTrail = 0,
  scheduled = 0,
  connections = [],
  badgeUser = {},
}: {
  screener?: number;
  imbox?: number;
  followUp?: number;
  replyLater?: number;
  feed?: number;
  paperTrail?: number;
  scheduled?: number;
  connections?: Array<{ email: string; sendAsEmail: string | null; aliases: string[] }>;
  badgeUser?: Record<string, boolean> | null;
}) {
  vi.mocked(db.emailConnection.findMany).mockResolvedValue(connections as never);
  vi.mocked(db.sender.count).mockResolvedValue(screener as never);
  vi.mocked(db.message.count)
    .mockResolvedValueOnce(imbox as never)
    .mockResolvedValueOnce(followUp as never)
    .mockResolvedValueOnce(replyLater as never)
    .mockResolvedValueOnce(feed as never)
    .mockResolvedValueOnce(paperTrail as never);
  vi.mocked(db.scheduledMessage.count).mockResolvedValue(scheduled as never);
  vi.mocked(db.user.findUnique).mockResolvedValue(badgeUser as never);
}

describe("computeSidebarCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all counts in the expected shape", async () => {
    seedCounts({
      screener: 3,
      imbox: 7,
      followUp: 1,
      replyLater: 2,
      feed: 4,
      paperTrail: 5,
      scheduled: 6,
    });

    const result = await computeSidebarCounts("user-1");

    expect(result).toMatchObject({
      screenerCount: 3,
      imboxUnreadCount: 7,
      followUpCount: 1,
      replyLaterCount: 2,
      feedUnreadCount: 4,
      paperTrailUnreadCount: 5,
      scheduledCount: 6,
    });
  });

  it("scopes every count query to the given userId (tenant isolation)", async () => {
    seedCounts({});

    await computeSidebarCounts("user-42");

    expect(
      vi.mocked(db.scheduledMessage.count).mock.calls[0][0]?.where,
    ).toMatchObject({ userId: "user-42" });
    for (const call of vi.mocked(db.message.count).mock.calls) {
      expect(call[0]?.where).toMatchObject({ userId: "user-42" });
    }
    expect(vi.mocked(db.sender.count).mock.calls[0][0]?.where).toMatchObject({
      userId: "user-42",
    });
    expect(vi.mocked(db.user.findUnique).mock.calls[0][0].where).toMatchObject({
      id: "user-42",
    });
  });

  it("excludes the user's own addresses from the screener count", async () => {
    seedCounts({
      connections: [
        { email: "Me@Example.com ", sendAsEmail: null, aliases: ["alias@example.com"] },
      ],
    });

    await computeSidebarCounts("user-1");

    const where = vi.mocked(db.sender.count).mock.calls[0][0]?.where;
    // visiblePendingSenderWhere lowercases + trims and puts excluded emails under NOT.
    expect(where?.NOT).toEqual({
      email: { in: ["me@example.com", "alias@example.com"] },
    });
  });

  it("falls back to default badge preferences when the user row has nulls", async () => {
    seedCounts({ badgeUser: null });

    const result = await computeSidebarCounts("user-1");

    expect(result.badgePreferences).toEqual({
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    });
  });

  it("honors stored badge preferences", async () => {
    seedCounts({
      badgeUser: {
        showImboxBadge: false,
        showScreenerBadge: true,
        showFeedBadge: false,
        showPaperTrailBadge: true,
        showFollowUpBadge: false,
        showReplyLaterBadge: true,
        showScheduledBadge: false,
      },
    });

    const result = await computeSidebarCounts("user-1");

    expect(result.badgePreferences.showImboxBadge).toBe(false);
    expect(result.badgePreferences.showScreenerBadge).toBe(true);
    expect(result.badgePreferences.showScheduledBadge).toBe(false);
  });
});
