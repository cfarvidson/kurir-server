"use server";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";

const INVITE_EXPIRY_DAYS = 7;

export async function createInvite(displayName: string, emailHint?: string) {
  await requireAdmin();

  const token = randomBytes(36).toString("base64url"); // 48 URL-safe chars
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  const session = await requireAdmin();

  const invite = await db.invite.create({
    data: {
      token,
      displayName,
      emailHint: emailHint || null,
      createdBy: session.user.id,
      expiresAt,
    },
  });

  revalidatePath("/settings/admin");
  return { id: invite.id, token: invite.token };
}

export async function revokeInvite(inviteId: string) {
  await requireAdmin();

  await db.invite.delete({ where: { id: inviteId } });
  revalidatePath("/settings/admin");
}

export async function listInvites() {
  await requireAdmin();

  return db.invite.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      displayName: true,
      emailHint: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}
