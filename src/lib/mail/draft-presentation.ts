import { getThreadRoute } from "@/lib/mail/route-helpers";
import { db } from "@/lib/db";
import { listDraftsForUser, type SaveDraftInput } from "@/lib/mail/drafts";

export const CONTEXT_MESSAGE_ID_ERROR =
  "contextMessageId must be a message id from get_thread, not a threadId";

export type DraftFolder = "imbox" | "feed" | "paper-trail" | "archive";

export type DraftPresentation = {
  displaySubject: string;
  displayFrom: string | null;
  folder: DraftFolder | null;
};

export type PresentedDraft = Awaited<
  ReturnType<typeof listDraftsForUser>
>[number] &
  DraftPresentation;

export type DraftContextMessage = {
  subject: string | null;
  fromName: string | null;
  fromAddress: string;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
};

export function draftFolderFromMessage(
  message: Pick<
    DraftContextMessage,
    "isInImbox" | "isInFeed" | "isInPaperTrail" | "isArchived"
  >,
): DraftFolder {
  return getThreadRoute(message).slice(1) as DraftFolder;
}

export function presentDraft(
  draft: { type: string; subject: string },
  message: DraftContextMessage | null,
): DraftPresentation {
  const saved = draft.subject.trim();
  const original = message?.subject?.trim() ?? "";
  const displaySubject = saved || original;
  const displayFrom =
    draft.type === "REPLY" && message
      ? message.fromName?.trim() || message.fromAddress
      : null;
  const folder = message ? draftFolderFromMessage(message) : null;
  return { displaySubject, displayFrom, folder };
}

export function draftCatalogHref(input: {
  type: string;
  contextMessageId: string;
  folder: DraftFolder | null;
}): string {
  const id = encodeURIComponent(input.contextMessageId);
  if (input.type === "NEW") return `/compose?draft=${id}&from=/drafts`;
  if (input.type === "FORWARD") {
    return `/compose?forward=${id}&from=/drafts`;
  }
  if (input.type === "REPLY" && input.folder) {
    return `/${input.folder}/${id}`;
  }
  return `/compose?draftType=${input.type}&draft=${id}&from=/drafts`;
}

export function pickReplyDraftForThread<
  T extends { type: string; contextMessageId: string; updatedAt: Date },
>(drafts: T[], messageIds: string[]): T | null {
  const idSet = new Set(messageIds);
  const matches = drafts.filter(
    (d) => d.type === "REPLY" && idSet.has(d.contextMessageId),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, d) =>
    d.updatedAt > best.updatedAt ? d : best,
  );
}

export function replyDraftSubject(
  savedSubject: string | undefined,
  originalSubject: string,
): string {
  const saved = (savedSubject ?? "").trim();
  return saved || originalSubject.trim();
}

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
