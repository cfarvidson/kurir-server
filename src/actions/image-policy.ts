"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Revalidate the views where a remote-image policy change is visible. Image
 * blocking renders in every message body, so refresh the category list pages.
 */
function revalidateImagePolicyPaths() {
  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/screener");
  revalidatePath("/sent");
  revalidatePath("/archive");
  revalidatePath("/settings");
}

/**
 * Set the per-sender remote-image allowlist. When `allow` is true, remote
 * images from this sender are always loaded regardless of the global default.
 */
export async function setSenderImagePolicy(senderId: string, allow: boolean) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership before mutating.
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== session.user.id) {
    throw new Error("Sender not found");
  }

  await db.sender.update({
    where: { id: senderId },
    data: { allowRemoteImages: allow },
  });

  revalidateImagePolicyPaths();
}

/**
 * Set the user's global "block remote images" preference (default true).
 */
export async function setBlockRemoteImages(block: boolean) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { blockRemoteImages: block },
  });

  revalidateImagePolicyPaths();
}
