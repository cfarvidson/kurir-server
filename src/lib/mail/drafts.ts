import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { DraftType } from "@prisma/client";

/**
 * Draft persistence cores, shared by the web server actions (`@/actions/drafts`)
 * and the mobile CRUD route (`/api/mobile/drafts`). Auth and cache invalidation
 * stay in the callers; these functions take a resolved `userId` and only touch
 * the database, so both surfaces upsert against the identical
 * `(userId, type, contextMessageId)` key and never drift.
 */

/**
 * Shared PUT/save body schema. Kept here (not in the route) so web and mobile
 * validate drafts against one definition. `contextMessageId` is the messageId
 * for REPLY/FORWARD and `"__new__"` for NEW (see schema.prisma Draft).
 */
export const saveDraftSchema = z.object({
  type: z.nativeEnum(DraftType),
  contextMessageId: z.string().min(1).default("__new__"),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  emailConnectionId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export type DraftAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
};

/**
 * Resolve uploaded/IMAP attachments for a draft in the order of `ids`.
 * Missing or unowned ids are dropped — never turned into a 0-byte chip.
 */
export async function loadAttachmentMeta(
  userId: string,
  ids: string[],
): Promise<DraftAttachmentMeta[]> {
  if (ids.length === 0) return [];
  const rows = await db.attachment.findMany({
    where: {
      id: { in: ids },
      OR: [{ userId }, { message: { userId } }],
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        url: `/api/attachments/${row.id}`,
      },
    ];
  });
}

function bumpDraftsPage() {
  revalidatePath("/drafts");
}

/**
 * Upsert a draft for `userId`. Validates that any referenced attachments belong
 * to the user, then last-write-wins on the `(userId, type, contextMessageId)`
 * unique key — the same contract the web composer autosave relies on.
 */
export async function saveDraftForUser(userId: string, input: SaveDraftInput) {
  // Validate attachmentIds belong to this user (uploads or IMAP-synced).
  if (input.attachmentIds?.length) {
    const owned = await db.attachment.count({
      where: {
        id: { in: input.attachmentIds },
        OR: [{ userId }, { message: { userId } }],
      },
    });
    if (owned !== input.attachmentIds.length) {
      throw new Error("Invalid attachment references");
    }
  }

  const draft = await db.draft.upsert({
    where: {
      userId_type_contextMessageId: {
        userId,
        type: input.type,
        contextMessageId: input.contextMessageId,
      },
    },
    update: {
      to: input.to ?? "",
      cc: input.cc ?? "",
      bcc: input.bcc ?? "",
      subject: input.subject ?? "",
      body: input.body ?? "",
      emailConnectionId: input.emailConnectionId ?? null,
      attachmentIds: input.attachmentIds ?? [],
    },
    create: {
      userId,
      type: input.type,
      contextMessageId: input.contextMessageId,
      to: input.to ?? "",
      cc: input.cc ?? "",
      bcc: input.bcc ?? "",
      subject: input.subject ?? "",
      body: input.body ?? "",
      emailConnectionId: input.emailConnectionId ?? null,
      attachmentIds: input.attachmentIds ?? [],
    },
  });
  bumpDraftsPage();
  return draft;
}

/** Fetch a single draft by its `(userId, type, contextMessageId)` key. */
export async function getDraftForUser(
  userId: string,
  type: DraftType,
  contextMessageId: string,
) {
  return db.draft.findUnique({
    where: {
      userId_type_contextMessageId: { userId, type, contextMessageId },
    },
  });
}

/** Delete a draft. Idempotent — deleting a missing draft is a no-op. */
export async function deleteDraftForUser(
  userId: string,
  type: DraftType,
  contextMessageId: string,
) {
  await db.draft.deleteMany({
    where: { userId, type, contextMessageId },
  });
  bumpDraftsPage();
}

/** All of the user's drafts, newest first. */
export async function listDraftsForUser(userId: string) {
  return db.draft.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}
