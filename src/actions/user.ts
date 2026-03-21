"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
