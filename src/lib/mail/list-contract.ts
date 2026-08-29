import { Prisma } from "@prisma/client";

export type MailListId =
  | "imbox"
  | "feed"
  | "paper-trail"
  | "archive"
  | "snoozed"
  | "follow-up"
  | "sent"
  | "reply-later";

export type SearchCategory = Exclude<MailListId, "reply-later">;

export type ListActionSet = {
  followUp: boolean;
  snooze: boolean;
  archive: boolean;
  unarchive: boolean;
};

export type EmptyCopy = { title: string; description: string };

const SECTION_LISTS: ReadonlySet<MailListId> = new Set([
  "imbox",
  "feed",
  "paper-trail",
]);

const EMPTY_COPY: Record<MailListId, EmptyCopy> = {
  imbox: {
    title: "Your Imbox is empty",
    description:
      "Approve senders in the Screener to see their emails here.",
  },
  feed: {
    title: "No newsletters yet",
    description:
      "Screen in newsletter senders and send them to The Feed.",
  },
  "paper-trail": {
    title: "No receipts yet",
    description:
      "Screen in transactional senders and send them to Paper Trail.",
  },
  snoozed: {
    title: "No snoozed conversations",
    description:
      "Snoozed conversations will appear here until they wake up.",
  },
  "follow-up": {
    title: "No follow-ups",
    description:
      "Threads you're waiting on will appear here when the deadline passes.",
  },
  archive: {
    title: "Archive is empty",
    description: "Archived conversations will appear here.",
  },
  sent: {
    title: "No sent messages",
    description: "Messages you send will appear here.",
  },
  "reply-later": {
    title: "All caught up",
    description: "Nothing left to reply to. Nice work.",
  },
};

export function threadCountLabel(count: number | undefined): string | null {
  if (count === undefined || count <= 1) return null;
  return `·${count}`;
}

export function primaryLine(input: {
  list: MailListId;
  displayName?: string | null;
  fromName?: string | null;
  fromAddress: string;
  toAddresses?: string[];
  cc?: string | null;
}): string {
  if (input.list === "sent") {
    const to = input.toAddresses ?? [];
    if (to.length > 0) return `To: ${to.join(", ")}`;
    const cc = input.cc?.trim();
    if (cc) return `Cc: ${cc}`;
    return "Bcc only";
  }

  return (
    input.displayName?.trim() ||
    input.fromName?.trim() ||
    input.fromAddress
  );
}

export function listActionSet(list: MailListId): ListActionSet {
  switch (list) {
    case "imbox":
    case "feed":
    case "paper-trail":
    case "snoozed":
      return {
        followUp: true,
        snooze: true,
        archive: true,
        unarchive: false,
      };
    case "follow-up":
      return {
        followUp: true,
        snooze: false,
        archive: true,
        unarchive: false,
      };
    case "sent":
      return {
        followUp: true,
        snooze: false,
        archive: false,
        unarchive: false,
      };
    case "archive":
      return {
        followUp: true,
        snooze: false,
        archive: false,
        unarchive: true,
      };
    case "reply-later":
      return {
        followUp: false,
        snooze: false,
        archive: false,
        unarchive: false,
      };
  }
}

export function searchActionProps(list: MailListId) {
  const set = listActionSet(list);
  return {
    showFollowUpAction: set.followUp,
    showSnoozeAction: set.snooze,
    showArchiveAction: set.archive,
    showUnarchiveAction: set.unarchive,
  };
}

export function swipeActions(list: MailListId): {
  leading: "read" | null;
  trailing: "archive" | "unarchive" | null;
} {
  if (list === "reply-later") return { leading: null, trailing: null };
  const set = listActionSet(list);
  return {
    leading: "read",
    trailing: set.unarchive ? "unarchive" : set.archive ? "archive" : null,
  };
}

export function emptyCopy(list: MailListId): EmptyCopy {
  return EMPTY_COPY[list];
}

export function showsSections(list: MailListId): boolean {
  return SECTION_LISTS.has(list);
}

export function showsSearch(list: MailListId): boolean {
  return list !== "reply-later";
}

export const SEARCHABLE_LIST_LABELS: Record<SearchCategory, string> = {
  imbox: "Imbox",
  feed: "The Feed",
  "paper-trail": "Paper Trail",
  archive: "Archive",
  snoozed: "Snoozed",
  "follow-up": "Follow-up",
  sent: "Sent",
};

/** Default search is all mail. `scope=list` keeps today's category filter. */
export function searchCategoryForScope(
  list: SearchCategory,
  scope: string | undefined | null,
): SearchCategory | null {
  return scope === "list" ? list : null;
}

export type SearchHitFlags = {
  isSnoozed?: boolean;
  isFollowUp?: boolean;
  isArchived?: boolean;
  isInImbox?: boolean;
  isInFeed?: boolean;
  isInPaperTrail?: boolean;
  isSent?: boolean;
};

/** Overlay lists win so mixed all-mail hits can tell Imbox from Archive. */
export function listForSearchHit(hit: SearchHitFlags): SearchCategory | null {
  if (hit.isSnoozed) return "snoozed";
  if (hit.isFollowUp && !hit.isArchived) return "follow-up";
  if (hit.isArchived) return "archive";
  if (hit.isInImbox) return "imbox";
  if (hit.isInFeed) return "feed";
  if (hit.isInPaperTrail) return "paper-trail";
  if (hit.isSent) return "sent";
  return null;
}

export function listLabelForSearchHit(hit: SearchHitFlags): string | null {
  const id = listForSearchHit(hit);
  if (!id) return null;
  return SEARCHABLE_LIST_LABELS[id];
}

export function searchCategoryFilter(
  category: SearchCategory | null,
): Prisma.Sql {
  if (category === null) return Prisma.empty;

  switch (category) {
    case "imbox":
      return Prisma.sql`AND "isInImbox" = true AND "isSnoozed" = false AND "isReplyLater" = false`;
    case "feed":
      return Prisma.sql`AND "isInFeed" = true AND "isSnoozed" = false AND "isReplyLater" = false`;
    case "paper-trail":
      return Prisma.sql`AND "isInPaperTrail" = true AND "isSnoozed" = false AND "isReplyLater" = false`;
    case "archive":
      return Prisma.sql`AND "isArchived" = true`;
    case "snoozed":
      return Prisma.sql`AND "isSnoozed" = true`;
    case "follow-up":
      return Prisma.sql`AND "isFollowUp" = true AND "isArchived" = false`;
    case "sent":
      return Prisma.sql`AND EXISTS (
  SELECT 1 FROM "Folder" f
  WHERE f.id = "Message"."folderId" AND (
    f."specialUse" = 'sent' OR f.path ILIKE '%sent%'
  )
)`;
  }
}

export function uniqueBlockSenderIds(
  rows: { senderId: string | null; fromAddress: string }[],
  isOwn: (email: string) => boolean,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (!row.senderId) continue;
    if (isOwn(row.fromAddress)) continue;
    if (seen.has(row.senderId)) continue;
    seen.add(row.senderId);
    ids.push(row.senderId);
  }
  return ids;
}

export function bulkReadMarksRead(rows: { isRead: boolean }[]): boolean {
  return rows.some((row) => !row.isRead);
}
