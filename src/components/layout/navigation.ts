import {
  Archive,
  Bell,
  Clock,
  Calendar,
  CalendarClock,
  Inbox,
  Filter,
  Mail,
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
      // Pinned sits with the mailboxes so it is one click away; it is not
      // a category and carries no badge.
      { name: "Pinned", href: "/pinned", icon: Pin },
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

function navItem(href: string): NavItem {
  const item = navigation.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`No navigation item for ${href}`);
  return item;
}

function groupById(id: string): NavGroup {
  const group = navigationGroups.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`No navigation group ${id}`);
  return group;
}

export type RailId = "mail" | "screener" | "calendar" | "contacts" | "files";

/**
 * One icon in the desktop sidebar's rail. Clicking it goes to `href`; the
 * panel beside the rail then lists `groups`. Every navigation item sits in
 * exactly one section. Mirrors `RailSection` in kurir-ios.
 */
export interface RailSection {
  id: RailId;
  name: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: BadgeKey;
  groups: NavGroup[];
}

export const railSections: RailSection[] = [
  {
    id: "mail",
    name: "Mail",
    href: "/imbox",
    icon: Mail,
    badgeKey: "imbox",
    groups: [
      groupById("mail"),
      groupById("later"),
      groupById("outbound"),
      { id: "archive", label: null, items: [navItem("/archive")] },
    ],
  },
  {
    id: "screener",
    name: "Screener",
    href: "/screener",
    icon: Filter,
    badgeKey: "screener",
    groups: [
      {
        id: "screener",
        label: null,
        items: [navItem("/screener"), navItem("/filters")],
      },
    ],
  },
  {
    id: "calendar",
    name: "Calendar",
    href: "/calendar",
    icon: Calendar,
    groups: [{ id: "calendar", label: null, items: [navItem("/calendar")] }],
  },
  {
    id: "contacts",
    name: "Contacts",
    href: "/contacts",
    icon: BookUser,
    groups: [{ id: "contacts", label: null, items: [navItem("/contacts")] }],
  },
  {
    id: "files",
    name: "Files",
    href: "/files",
    icon: Paperclip,
    groups: [{ id: "files", label: null, items: [navItem("/files")] }],
  },
];

/**
 * The rail section a page belongs to. Sub-pages count too (/calendar/day,
 * /contacts/groups, /imbox/<thread>). Pages outside every section
 * (settings, compose, search) show the Mail panel.
 */
export function railSectionFor(pathname: string): RailSection {
  return (
    railSections.find((section) =>
      section.groups.some((group) =>
        group.items.some(
          (item) =>
            pathname === item.href || pathname.startsWith(`${item.href}/`),
        ),
      ),
    ) ?? railSections[0]
  );
}
