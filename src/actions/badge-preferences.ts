"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath, revalidateTag } from "next/cache";
import type { BadgePreferences } from "@/components/layout/navigation";

export type { BadgePreferences };

const BADGE_FIELDS = [
  "showImboxBadge",
  "showScreenerBadge",
  "showFeedBadge",
  "showPaperTrailBadge",
  "showFollowUpBadge",
  "showScheduledBadge",
] as const;

export async function getBadgePreferences(
  userId: string,
): Promise<BadgePreferences> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showScheduledBadge: true,
    },
  });

  return {
    showImboxBadge: user?.showImboxBadge ?? true,
    showScreenerBadge: user?.showScreenerBadge ?? true,
    showFeedBadge: user?.showFeedBadge ?? true,
    showPaperTrailBadge: user?.showPaperTrailBadge ?? true,
    showFollowUpBadge: user?.showFollowUpBadge ?? true,
    showScheduledBadge: user?.showScheduledBadge ?? true,
  };
}

export async function updateBadgePreferences(
  prefs: Partial<BadgePreferences>,
) {
  const session = await requireAuth();

  // Validate: only accept known boolean fields
  const data: Record<string, boolean> = {};
  for (const field of BADGE_FIELDS) {
    if (field in prefs && typeof prefs[field] === "boolean") {
      data[field] = prefs[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No valid preferences provided");
  }

  await db.user.update({
    where: { id: session.user.id },
    data,
  });

  revalidateTag("sidebar-counts");
  revalidatePath("/settings");
}
