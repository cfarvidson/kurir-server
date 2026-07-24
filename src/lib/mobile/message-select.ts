/**
 * Message metadata shape shared by the mobile sync and search endpoints.
 * The iOS client upserts rows of this shape into its local GRDB store, so
 * both endpoints must return identical fields.
 */
export const MESSAGE_SELECT = {
  id: true,
  updatedAt: true,
  threadId: true,
  messageId: true,
  inReplyTo: true,
  references: true,
  subject: true,
  fromAddress: true,
  fromName: true,
  toAddresses: true,
  ccAddresses: true,
  replyTo: true,
  sentAt: true,
  receivedAt: true,
  snippet: true,
  isRead: true,
  isFlagged: true,
  isDraft: true,
  isAnswered: true,
  hasAttachments: true,
  isInImbox: true,
  isInScreener: true,
  isInFeed: true,
  isInPaperTrail: true,
  isArchived: true,
  isSnoozed: true,
  snoozedUntil: true,
  isReplyLater: true,
  isFollowUp: true,
  followUpAt: true,
  senderId: true,
  emailConnectionId: true,
  folder: { select: { specialUse: true } },
} as const;

/**
 * Flatten the nested `folder.specialUse` into a flat `folderRole` string so
 * the iOS client's decoder stays flat. Both mobile endpoints must run their
 * MESSAGE_SELECT rows through this before serializing.
 */
export function flattenFolderRole<
  T extends { folder: { specialUse: string | null } | null },
>(rows: T[]): (Omit<T, "folder"> & { folderRole: string | null })[] {
  return rows.map(({ folder, ...rest }) => ({
    ...rest,
    folderRole: folder?.specialUse ?? null,
  }));
}
