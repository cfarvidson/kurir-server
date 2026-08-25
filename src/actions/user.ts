"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/timezone";
import { revalidatePath } from "next/cache";

const VALID_THEMES = ["light", "dark", "system"] as const;

export async function updateTheme(theme: string) {
  const session = await requireAuth();

  if (!VALID_THEMES.includes(theme as (typeof VALID_THEMES)[number])) {
    throw new Error("Invalid theme");
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { theme },
  });

  revalidatePath("/", "layout");
}

export async function updateTimezone(timezone: string) {
  const session = await requireAuth();

  if (!isValidTimeZone(timezone)) throw new Error("Invalid timezone");

  await db.user.update({
    where: { id: session.user.id },
    data: { timezone },
  });

  // The calendar, snooze and scheduled-send all read the zone server-side.
  revalidatePath("/", "layout");
}

/**
 * First-visit adoption: writes the browser's reported zone only while the
 * account has never chosen one (timezone is null - the state migration 0019
 * leaves every untouched account in). An explicit choice in Settings is
 * never overwritten, so a self-hosted account that wants UTC can say so.
 */
export async function adoptTimezone(timezone: string) {
  const session = await requireAuth();

  if (!isValidTimeZone(timezone)) throw new Error("Invalid timezone");

  const { count } = await db.user.updateMany({
    where: { id: session.user.id, timezone: null },
    data: { timezone },
  });

  if (count > 0) revalidatePath("/", "layout");
  return count > 0;
}

export async function updateDisplayName(displayName: string) {
  const session = await requireAuth();

  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("Display name cannot be empty");
  if (trimmed.length > 100) throw new Error("Display name too long");

  await db.user.update({
    where: { id: session.user.id },
    data: { displayName: trimmed },
  });

  revalidatePath("/settings");
  revalidatePath("/settings/admin");
}
