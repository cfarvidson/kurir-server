"use server";

import { auth } from "@/lib/auth";
import { DraftType } from "@prisma/client";
import {
  saveDraftForUser,
  getDraftForUser,
  deleteDraftForUser,
  type SaveDraftInput,
} from "@/lib/mail/drafts";

export async function saveDraft(data: SaveDraftInput) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return saveDraftForUser(session.user.id, data);
}

export async function deleteDraft(type: DraftType, contextMessageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await deleteDraftForUser(session.user.id, type, contextMessageId);
}

export async function getDraft(type: DraftType, contextMessageId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;

  return getDraftForUser(session.user.id, type, contextMessageId);
}
