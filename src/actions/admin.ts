"use server";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function toggleSignups(enabled: boolean) {
  await requireAdmin();
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { signupsEnabled: enabled },
    update: { signupsEnabled: enabled },
  });
  revalidatePath("/settings/admin");
}

export async function toggleSelfServiceAccountManagement(enabled: boolean) {
  await requireAdmin();
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { selfServiceAccountManagement: enabled },
    update: { selfServiceAccountManagement: enabled },
  });
  revalidatePath("/settings/admin");
}

export async function updateUserDisplayName(
  targetUserId: string,
  displayName: string,
) {
  await requireAdmin();

  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("Display name cannot be empty");
  if (trimmed.length > 100) throw new Error("Display name too long");

  await db.user.update({
    where: { id: targetUserId },
    data: { displayName: trimmed },
  });

  revalidatePath("/settings/admin");
}

export async function updateUserRole(
  targetUserId: string,
  newRole: "ADMIN" | "USER",
) {
  const session = await requireAdmin();

  // Prevent self-demotion
  if (targetUserId === session.user.id && newRole !== "ADMIN") {
    throw new Error("Cannot demote yourself. Ask another admin.");
  }

  await db.$transaction(
    async (tx) => {
      if (newRole !== "ADMIN") {
        // Check we're not removing the last admin
        const adminCount = await tx.user.count({
          where: { role: "ADMIN", NOT: { id: targetUserId } },
        });
        if (adminCount === 0) {
          throw new Error("Cannot remove the last admin");
        }
      }
      await tx.user.update({
        where: { id: targetUserId },
        data: { role: newRole },
      });
    },
    { isolationLevel: "Serializable" },
  );

  revalidatePath("/settings/admin");
}
