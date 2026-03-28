"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DraftType } from "@prisma/client";

export async function saveDraft(data: {
  type: DraftType;
  contextMessageId: string;
  to?: string;
  subject?: string;
  body?: string;
  emailConnectionId?: string;
  attachmentIds?: string[];
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  // Validate attachmentIds belong to this user
  if (data.attachmentIds?.length) {
    const owned = await db.attachment.count({
      where: { id: { in: data.attachmentIds }, userId },
    });
    if (owned !== data.attachmentIds.length) {
      throw new Error("Invalid attachment references");
    }
  }

  return db.draft.upsert({
    where: {
      userId_type_contextMessageId: {
        userId,
        type: data.type,
        contextMessageId: data.contextMessageId,
      },
    },
    update: {
      to: data.to ?? "",
      subject: data.subject ?? "",
      body: data.body ?? "",
      emailConnectionId: data.emailConnectionId ?? null,
      attachmentIds: data.attachmentIds ?? [],
    },
    create: {
      userId,
      type: data.type,
      contextMessageId: data.contextMessageId,
      to: data.to ?? "",
      subject: data.subject ?? "",
      body: data.body ?? "",
      emailConnectionId: data.emailConnectionId ?? null,
      attachmentIds: data.attachmentIds ?? [],
    },
  });
}

export async function deleteDraft(type: DraftType, contextMessageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await db.draft.deleteMany({
    where: {
      userId: session.user.id,
      type,
      contextMessageId,
    },
  });
}

export async function getDraft(type: DraftType, contextMessageId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;

  return db.draft.findUnique({
    where: {
      userId_type_contextMessageId: {
        userId: session.user.id,
        type,
        contextMessageId,
      },
    },
  });
}

export async function getUserDrafts() {
  const session = await auth();
  if (!session?.user?.id) return [];

  return db.draft.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
}
