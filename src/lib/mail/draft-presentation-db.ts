import { db } from "@/lib/db";
import { listDraftsForUser, type SaveDraftInput } from "@/lib/mail/drafts";
import {
  CONTEXT_MESSAGE_ID_ERROR,
  presentDraft,
  replyDraftSubject,
} from "@/lib/mail/draft-presentation";

const contextSelect = {
  id: true,
  subject: true,
  fromName: true,
  fromAddress: true,
  isInImbox: true,
  isInFeed: true,
  isInPaperTrail: true,
  isArchived: true,
  emailConnectionId: true,
} as const;

export async function presentDraftsForUser(userId: string) {
  const drafts = await listDraftsForUser(userId);
  const ids = drafts
    .filter((d) => d.type !== "NEW")
    .map((d) => d.contextMessageId);
  const messages = ids.length
    ? await db.message.findMany({
        where: { userId, id: { in: ids } },
        select: {
          id: true,
          subject: true,
          fromName: true,
          fromAddress: true,
          isInImbox: true,
          isInFeed: true,
          isInPaperTrail: true,
          isArchived: true,
        },
      })
    : [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  return drafts.map((draft) => ({
    ...draft,
    ...presentDraft(draft, byId.get(draft.contextMessageId) ?? null),
  }));
}

export async function findReplyDraftForThread(
  userId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return null;
  const rows = await db.draft.findMany({
    where: {
      userId,
      type: "REPLY",
      contextMessageId: { in: messageIds },
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  return rows[0] ?? null;
}

export async function loadDraftContextMessage(
  userId: string,
  messageId: string,
) {
  return db.message.findFirst({
    where: { userId, id: messageId },
    select: contextSelect,
  });
}

export async function prepareDraftSave(
  userId: string,
  input: SaveDraftInput,
): Promise<
  | {
      ok: true;
      input: SaveDraftInput;
      message: Awaited<ReturnType<typeof loadDraftContextMessage>>;
    }
  | { ok: false; message: string }
> {
  if (input.type === "NEW") return { ok: true, input, message: null };
  const message = await loadDraftContextMessage(userId, input.contextMessageId);
  if (!message) {
    return { ok: false, message: CONTEXT_MESSAGE_ID_ERROR };
  }
  return {
    ok: true,
    input: {
      ...input,
      subject: replyDraftSubject(input.subject, message.subject ?? ""),
      emailConnectionId: input.emailConnectionId ?? message.emailConnectionId,
    },
    message,
  };
}
