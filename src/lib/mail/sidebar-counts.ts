/**
 * Cached sidebar/badge counts for the `(mail)` layout.
 *
 * The mail layout previously ran ~8 uncached `db.count()` queries on every RSC
 * render. Because `router.refresh()` (fired after every mutating action and by
 * AutoSync) re-renders the whole tree — layout included — this blocked the
 * layout shell AND the page content behind a `Promise.all` of DB round-trips on
 * every action, which is the dominant cause of the PWA "freeze on navigate /
 * press" symptom.
 *
 * `getSidebarCounts` wraps the queries in Next's `"use cache"` directive tagged
 * `sidebar-counts`. The ~38 `updateTag("sidebar-counts")` calls already sprinkled
 * across `src/actions/` (and `revalidateTag("sidebar-counts")` in the sync route)
 * — previously no-ops because nothing was cached under that tag — now correctly
 * invalidate this entry, so counts stay fresh after mutations while navigation no
 * longer pays the query cost.
 *
 * `"use cache"` functions cannot read cookies/headers, so `userId` is passed in;
 * the layout resolves `auth()` and forwards it. The cache key is `userId`, so
 * counts never leak across tenants.
 */

import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { getUserEmails } from "@/lib/mail/user-emails";
import {
  type BadgePreferences,
  defaultBadgePreferences,
} from "@/components/layout/navigation";

export interface SidebarCounts {
  screenerCount: number;
  imboxUnreadCount: number;
  scheduledCount: number;
  followUpCount: number;
  replyLaterCount: number;
  feedUnreadCount: number;
  paperTrailUnreadCount: number;
  badgePreferences: BadgePreferences;
}

/**
 * Compute all sidebar counts + badge preferences for a user. Pure data access
 * (no auth, no caching) so it is unit-testable in the `node` Vitest environment
 * with a mocked `db`. `getSidebarCounts` is the cached wrapper around this.
 */
export async function computeSidebarCounts(
  userId: string,
): Promise<SidebarCounts> {
  const [
    screenerCount,
    imboxUnreadCount,
    scheduledCount,
    followUpCount,
    replyLaterCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    badgeUser,
  ] = await Promise.all([
    // The screener count needs the user's own addresses excluded; chain the
    // lookup so the other seven counts still fan out immediately.
    getUserEmails(userId).then((userEmails) =>
      db.sender.count({
        where: visiblePendingSenderWhere(
          userId,
          userEmails.length > 0 ? userEmails : null,
        ),
      }),
    ),
    db.message.count({
      where: {
        userId,
        isInImbox: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    db.scheduledMessage.count({
      where: { userId, status: "PENDING" },
    }),
    db.message.count({
      where: { userId, isFollowUp: true, isArchived: false },
    }),
    db.message.count({
      where: { userId, isReplyLater: true, isArchived: false },
    }),
    db.message.count({
      where: {
        userId,
        isInFeed: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    db.message.count({
      where: {
        userId,
        isInPaperTrail: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: {
        showImboxBadge: true,
        showScreenerBadge: true,
        showFeedBadge: true,
        showPaperTrailBadge: true,
        showFollowUpBadge: true,
        showReplyLaterBadge: true,
        showScheduledBadge: true,
      },
    }),
  ]);

  // Badge columns are non-nullable Boolean @default(true), so a present row
  // fully overrides the defaults and a missing row leaves them intact.
  const badgePreferences: BadgePreferences = {
    ...defaultBadgePreferences,
    ...badgeUser,
  };

  return {
    screenerCount,
    imboxUnreadCount,
    scheduledCount,
    followUpCount,
    replyLaterCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    badgePreferences,
  };
}

/**
 * Cached sidebar counts, keyed by `userId` and tagged `sidebar-counts`.
 * Invalidated by the existing `updateTag("sidebar-counts")` /
 * `revalidateTag("sidebar-counts")` calls in `src/actions/` and the sync route.
 */
export async function getSidebarCounts(userId: string): Promise<SidebarCounts> {
  "use cache";
  cacheLife("minutes");
  cacheTag("sidebar-counts");
  return computeSidebarCounts(userId);
}
