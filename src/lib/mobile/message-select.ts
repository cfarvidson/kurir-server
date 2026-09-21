import { serializeMobileMeeting } from "@/lib/calendar/meeting-card";
import {
  AI_VERDICT_SELECT,
  summarizeAIVerdict,
  type AIVerdict,
} from "@/lib/mail/content-rules";

/**
 * Message metadata shape shared by the mobile sync and search endpoints.
 * The iOS client upserts rows of this shape into its local GRDB store, so
 * both endpoints must return identical fields.
 */
export const MESSAGE_SELECT = {
  id: true,
  updatedAt: true,
  threadId: true,
  splitFromThreadId: true,
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
  meeting: {
    select: {
      uid: true,
      method: true,
      title: true,
      startAt: true,
      endAt: true,
      isAllDay: true,
      location: true,
      organizerName: true,
      organizerEmail: true,
      calendarEventId: true,
      calendarEvent: { select: { attendeesJson: true } },
    },
  },
  contentRuleMatches: AI_VERDICT_SELECT,
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

type MobileMeetingRow = {
  uid: string;
  method: string;
  title: string;
  startAt: Date | string | null;
  endAt: Date | string | null;
  isAllDay: boolean;
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  calendarEventId: string | null;
  calendarEvent?: { attendeesJson: unknown } | null;
};

type AIVerdictRow = Parameters<typeof summarizeAIVerdict>[0][number];

/**
 * Sync/search presentation: flat folderRole, `meeting` only when a
 * MessageMeeting row exists (native Task 7), and `aiVerdict` only when an
 * AI rule has judged the message. Omit those keys otherwise.
 */
type PresentedMobileMessage<T> = Omit<
  T,
  "folder" | "meeting" | "contentRuleMatches"
> & {
  folderRole: string | null;
  meeting?: ReturnType<typeof serializeMobileMeeting>;
  aiVerdict?: AIVerdict;
};

export function presentMobileMessages<
  T extends {
    folder: { specialUse: string | null } | null;
    meeting?: MobileMeetingRow | null;
    contentRuleMatches?: AIVerdictRow[];
  },
>(rows: T[]): Array<PresentedMobileMessage<T>> {
  // TS can't relate the chained generic Omits, hence the cast.
  return flattenFolderRole(rows).map((row) => {
    const { meeting, contentRuleMatches, ...rest } = row as typeof row & {
      meeting?: MobileMeetingRow | null;
      contentRuleMatches?: AIVerdictRow[];
    };
    const serialized = serializeMobileMeeting(meeting);
    const aiVerdict = summarizeAIVerdict(contentRuleMatches ?? []);
    return {
      ...rest,
      ...(serialized ? { meeting: serialized } : {}),
      ...(aiVerdict ? { aiVerdict } : {}),
    };
  }) as Array<PresentedMobileMessage<T>>;
}
