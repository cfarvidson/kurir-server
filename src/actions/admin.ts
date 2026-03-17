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
        if (adminCount < 1) {
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
