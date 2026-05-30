import {
  Archive,
  Bell,
  Clock,
  CalendarClock,
  Inbox,
  Filter,
  Send,
  Newspaper,
  Receipt,
  BookUser,
  Paperclip,
  Reply,
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

export const navigation: NavItem[] = [
  { name: "Imbox", href: "/imbox", icon: Inbox, badgeKey: "imbox" },
  { name: "Screener", href: "/screener", icon: Filter, badgeKey: "screener" },
  { name: "The Feed", href: "/feed", icon: Newspaper, badgeKey: "feed" },
  {
    name: "Paper Trail",
    href: "/paper-trail",
    icon: Receipt,
    badgeKey: "paperTrail",
  },
  { name: "Snoozed", href: "/snoozed", icon: Clock },
  { name: "Follow Up", href: "/follow-up", icon: Bell, badgeKey: "followUp" },
  {
    name: "Reply Later",
    href: "/reply-later",
    icon: Reply,
    badgeKey: "replyLater",
  },
  {
    name: "Scheduled",
    href: "/scheduled",
    icon: CalendarClock,
    badgeKey: "scheduled",
  },
  { name: "Sent", href: "/sent", icon: Send },
  { name: "Archive", href: "/archive", icon: Archive },
  { name: "Files", href: "/files", icon: Paperclip },
  { name: "Contacts", href: "/contacts", icon: BookUser },
];
