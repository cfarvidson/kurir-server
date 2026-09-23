import {
  Archive,
  Bell,
  Clock,
  Calendar,
  CalendarClock,
  Inbox,
  Filter,
  Send,
  Newspaper,
  Receipt,
  BookUser,
  Paperclip,
  Pin,
  Reply,
  SquarePen,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badgeKey?:
    | "imbox"
    | "screener"
    | "scheduled"
    | "followUp"
    | "replyLater"
    | "feed"
    | "paperTrail";
}

export type BadgeKey = NonNullable<NavItem["badgeKey"]>;

export interface BadgePreferences {
  showImboxBadge: boolean;
  showScreenerBadge: boolean;
  showFeedBadge: boolean;
  showPaperTrailBadge: boolean;
  showFollowUpBadge: boolean;
  showReplyLaterBadge: boolean;
  showScheduledBadge: boolean;
}

export const badgeKeyToPref: Record<BadgeKey, keyof BadgePreferences> = {
  imbox: "showImboxBadge",
  screener: "showScreenerBadge",
  feed: "showFeedBadge",
  paperTrail: "showPaperTrailBadge",
  followUp: "showFollowUpBadge",
  replyLater: "showReplyLaterBadge",
  scheduled: "showScheduledBadge",
};

export const defaultBadgePreferences: BadgePreferences = {
  showImboxBadge: true,
  showScreenerBadge: true,
  showFeedBadge: true,
  showPaperTrailBadge: true,
  showFollowUpBadge: true,
  showReplyLaterBadge: true,
  showScheduledBadge: true,
};

export interface NavGroup {
  id: string;
  /** Quiet eyebrow label. Null = unlabeled cluster (primary destinations). */
  label: string | null;
  items: NavItem[];
}

export const navigationGroups: NavGroup[] = [
  {
    id: "mail",
    label: null,
    items: [
      { name: "Imbox", href: "/imbox", icon: Inbox, badgeKey: "imbox" },
      { name: "The Feed", href: "/feed", icon: Newspaper, badgeKey: "feed" },
      {
        name: "Paper Trail",
        href: "/paper-trail",
        icon: Receipt,
        badgeKey: "paperTrail",
      },
    ],
  },
  {
    id: "triage",
    label: "Triage",
    items: [
      { name: "Screener", href: "/screener", icon: Filter, badgeKey: "screener" },
      { name: "AI Rules", href: "/filters", icon: Sparkles },
    ],
  },
  {
    id: "later",
    label: "Later",
    items: [
      { name: "Snoozed", href: "/snoozed", icon: Clock },
      {
        name: "Reply Later",
        href: "/reply-later",
        icon: Reply,
        badgeKey: "replyLater",
      },
      { name: "Follow Up", href: "/follow-up", icon: Bell, badgeKey: "followUp" },
      { name: "Pinned", href: "/pinned", icon: Pin },
    ],
  },
  {
    id: "outbound",
    label: "Outbound",
    items: [
      { name: "Drafts", href: "/drafts", icon: SquarePen },
      {
        name: "Scheduled",
        href: "/scheduled",
        icon: CalendarClock,
        badgeKey: "scheduled",
      },
      { name: "Sent", href: "/sent", icon: Send },
    ],
  },
  {
    id: "library",
    label: null,
    items: [
      { name: "Calendar", href: "/calendar", icon: Calendar },
      { name: "Archive", href: "/archive", icon: Archive },
      { name: "Files", href: "/files", icon: Paperclip },
      { name: "Contacts", href: "/contacts", icon: BookUser },
    ],
  },
];

/** Flat list for callers that only need destinations, not grouping. */
export const navigation: NavItem[] = navigationGroups.flatMap(
  (group) => group.items,
);
