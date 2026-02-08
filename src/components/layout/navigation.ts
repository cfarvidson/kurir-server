import {
  Archive,
  Inbox,
  Filter,
  Send,
  Newspaper,
  Receipt,
  BookUser,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: "imbox" | "screener";
}

export const navigation: NavItem[] = [
  { name: "Imbox", href: "/imbox", icon: Inbox, badgeKey: "imbox" },
  { name: "Screener", href: "/screener", icon: Filter, badgeKey: "screener" },
  { name: "The Feed", href: "/feed", icon: Newspaper },
  { name: "Paper Trail", href: "/paper-trail", icon: Receipt },
  { name: "Sent", href: "/sent", icon: Send },
  { name: "Archive", href: "/archive", icon: Archive },
  { name: "Contacts", href: "/contacts", icon: BookUser },
];
