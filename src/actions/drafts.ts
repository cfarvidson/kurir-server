"use server";

import { auth } from "@/lib/auth";
import { DraftType } from "@prisma/client";
import {
  saveDraftForUser,
  getDraftForUser,
  deleteDraftForUser,
  listDraftsForUser,
  loadAttachmentMeta,
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

  const draft = await getDraftForUser(session.user.id, type, contextMessageId);
  if (!draft) return null;
  const attachments = await loadAttachmentMeta(
    session.user.id,
    draft.attachmentIds,
  );
  return { ...draft, attachments };
}

export async function getAttachmentMeta(ids: string[]) {
  const session = await auth();
  if (!session?.user?.id) return [];
  return loadAttachmentMeta(session.user.id, ids);
}

export async function listDrafts() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return listDraftsForUser(session.user.id);
}
