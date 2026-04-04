"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Inbox, Filter, Newspaper, Receipt, PenSquare } from "lucide-react";
import {
  type BadgePreferences,
  badgeKeyToPref,
  defaultBadgePreferences,
} from "./navigation";

interface MobileTabBarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
  feedUnreadCount?: number;
  paperTrailUnreadCount?: number;
  badgePreferences?: BadgePreferences;
}

const tabs = [
  { name: "Imbox", href: "/imbox", icon: Inbox, badgeKey: "imbox" as const },
  {
    name: "Screener",
    href: "/screener",
    icon: Filter,
    badgeKey: "screener" as const,
  },
  { name: "Compose", href: "/compose", icon: PenSquare, badgeKey: null },
  {
    name: "Feed",
    href: "/feed",
    icon: Newspaper,
    badgeKey: "feed" as const,
  },
  {
    name: "Paper Trail",
    href: "/paper-trail",
    icon: Receipt,
    badgeKey: "paperTrail" as const,
  },
];

export function MobileTabBar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  badgePreferences = defaultBadgePreferences,
}: MobileTabBarProps) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const pathname = usePathname();

  // Listen for optimistic badge updates
  useEffect(() => {
    const handler = (e: Event) => {
      const { key, delta } = (e as CustomEvent).detail;
      setDeltas((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + delta }));
    };
    window.addEventListener("badge-count-update", handler);
    return () => window.removeEventListener("badge-count-update", handler);
  }, []);

  // Reset deltas when server props change
  useEffect(() => {
    setDeltas({});
  }, [screenerCount, imboxUnreadCount, feedUnreadCount, paperTrailUnreadCount]);

  const badgeCounts: Record<string, number> = {
    imbox: Math.max(0, imboxUnreadCount + (deltas.imbox ?? 0)),
    screener: Math.max(0, screenerCount + (deltas.screener ?? 0)),
    feed: Math.max(0, feedUnreadCount + (deltas.feed ?? 0)),
    paperTrail: Math.max(0, paperTrailUnreadCount + (deltas.paperTrail ?? 0)),
  };

  // Hide on sub-pages (thread detail views have their own action bar)
  const segments = pathname.split("/").filter(Boolean);
  const isSubPage = segments.length > 1;
  if (isSubPage) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const isCompose = tab.badgeKey === null;
          const count = tab.badgeKey ? badgeCounts[tab.badgeKey] : 0;
          const prefKey = tab.badgeKey
            ? badgeKeyToPref[tab.badgeKey]
            : undefined;
          const showBadge =
            count > 0 && prefKey && badgePreferences[prefKey] !== false;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                isCompose
                  ? "text-primary"
                  : isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground",
              )}
            >
              <div className="relative">
                <tab.icon
                  className={cn(
                    "h-5 w-5",
                    isCompose && "h-6 w-6",
                  )}
                />
                {showBadge && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </div>
              <span className={cn(isCompose && "text-[10px]")}>
                {tab.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
