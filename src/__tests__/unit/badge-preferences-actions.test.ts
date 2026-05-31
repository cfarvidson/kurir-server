import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

describe("getBadgePreferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects reading another user's preferences", async () => {
    const { requireAuth } = await import("@/lib/auth");
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: "user-A" } } as never);

    const { db } = await import("@/lib/db");
    const { getBadgePreferences } = await import("@/actions/badge-preferences");

    await expect(getBadgePreferences("user-B")).rejects.toThrow("Forbidden");
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns preferences for the caller's own id", async () => {
    const { requireAuth } = await import("@/lib/auth");
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: "user-A" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      showImboxBadge: false,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);

    const { getBadgePreferences } = await import("@/actions/badge-preferences");
    const prefs = await getBadgePreferences("user-A");

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-A" },
      select: expect.any(Object),
    });
    expect(prefs.showImboxBadge).toBe(false);
    expect(prefs.showScreenerBadge).toBe(true);
  });
});
