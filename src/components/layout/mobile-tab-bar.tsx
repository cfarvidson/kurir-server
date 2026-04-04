"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Filter,
  Newspaper,
  PenSquare,
  MoreHorizontal,
  Receipt,
  Clock,
  Bell,
  CalendarClock,
  Send,
  Archive,
  BookUser,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import {
  type BadgePreferences,
  badgeKeyToPref,
  defaultBadgePreferences,
} from "./navigation";
import { useBadgeCounts } from "@/hooks/use-badge-counts";

interface MobileTabBarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
  feedUnreadCount?: number;
  paperTrailUnreadCount?: number;
  scheduledCount?: number;
  followUpCount?: number;
  badgePreferences?: BadgePreferences;
  isAdmin?: boolean;
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
  // "More" is rendered separately as a button
];

const moreItems = [
  {
    name: "Paper Trail",
    href: "/paper-trail",
    icon: Receipt,
    badgeKey: "paperTrail" as const,
  },
  { name: "Snoozed", href: "/snoozed", icon: Clock, badgeKey: null },
  {
    name: "Follow Up",
    href: "/follow-up",
    icon: Bell,
    badgeKey: "followUp" as const,
  },
  {
    name: "Scheduled",
    href: "/scheduled",
    icon: CalendarClock,
    badgeKey: "scheduled" as const,
  },
  { name: "Sent", href: "/sent", icon: Send, badgeKey: null },
  { name: "Archive", href: "/archive", icon: Archive, badgeKey: null },
  { name: "Contacts", href: "/contacts", icon: BookUser, badgeKey: null },
];

const TRANSITION = "transform 0.3s cubic-bezier(0.2, 0, 0, 1)";

export function MobileTabBar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  scheduledCount = 0,
  followUpCount = 0,
  badgePreferences = defaultBadgePreferences,
  isAdmin = false,
}: MobileTabBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Gesture state for drag-to-dismiss
  const gestureState = useRef({
    startY: 0,
    currentY: 0,
    tracking: false,
  });

  const badgeCounts = useBadgeCounts({
    screenerCount,
    imboxUnreadCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    scheduledCount,
    followUpCount,
  });

  // Close sheet on route change
  useEffect(() => {
    setSheetOpen(false);
    document.body.style.overflow = "";
  }, [pathname]);

  const openSheet = useCallback(() => {
    setSheetOpen(true);
    document.body.style.overflow = "hidden";
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    document.body.style.overflow = "";
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Drag-to-dismiss gesture
  useEffect(() => {
    if (!sheetOpen) return;

    const sheet = sheetRef.current;
    if (!sheet) return;

    function onTouchStart(e: TouchEvent) {
      gestureState.current.startY = e.touches[0].clientY;
      gestureState.current.currentY = e.touches[0].clientY;
      gestureState.current.tracking = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!gestureState.current.tracking) return;
      const dy = e.touches[0].clientY - gestureState.current.startY;
      gestureState.current.currentY = e.touches[0].clientY;

      // Only allow dragging down
      if (dy > 0 && sheet) {
        sheet.style.transition = "none";
        sheet.style.transform = `translateY(${dy}px)`;
        if (backdropRef.current) {
          backdropRef.current.style.transition = "none";
          backdropRef.current.style.opacity = String(
            Math.max(0, 0.4 - (dy / 400) * 0.4),
          );
        }
      }
    }

    function onTouchEnd() {
      if (!gestureState.current.tracking) return;
      gestureState.current.tracking = false;
      const dy = gestureState.current.currentY - gestureState.current.startY;

      if (dy > 80) {
        closeSheet();
      } else if (sheet) {
        sheet.style.transition = TRANSITION;
        sheet.style.transform = "translateY(0)";
        if (backdropRef.current) {
          backdropRef.current.style.transition =
            "opacity 0.3s cubic-bezier(0.2, 0, 0, 1)";
          backdropRef.current.style.opacity = "0.4";
        }
      }
    }

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: true });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
    };
  }, [sheetOpen, closeSheet]);

  // Hide on sub-pages (thread detail views have their own action bar)
  const segments = pathname.split("/").filter(Boolean);
  const isSubPage = segments.length > 1;
  if (isSubPage) return null;

  // Check if any "more" item is active (to highlight the More tab)
  const moreHrefs = [...moreItems.map((i) => i.href), "/settings", "/admin"];
  const isMoreActive = moreHrefs.some(
    (href) => pathname === href || (href !== "/" && pathname.startsWith(href)),
  );

  return (
    <div className="md:hidden">
      {/* Tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
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
                  <tab.icon className={cn("h-5 w-5", isCompose && "h-6 w-6")} />
                  {showBadge && (
                    <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </div>
                <span>{tab.name}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={sheetOpen ? closeSheet : openSheet}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              isMoreActive || sheetOpen
                ? "text-primary"
                : "text-muted-foreground active:text-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Bottom sheet backdrop */}
      {sheetOpen && (
        <div
          ref={backdropRef}
          onClick={closeSheet}
          className="fixed inset-0 z-50 bg-black"
          style={{ opacity: 0.4 }}
        />
      )}

      {/* Bottom sheet */}
      {sheetOpen && (
        <div
          ref={sheetRef}
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card shadow-2xl"
          style={{
            transform: "translateY(0)",
            transition: TRANSITION,
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
          }}
        >
          {/* Drag handle */}
          <div className="flex justify-center py-3">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          {/* Navigation items */}
          <nav className="px-4 pb-2">
            {moreItems.map((item) => {
              if (item.badgeKey === "scheduled" && badgeCounts.scheduled === 0)
                return null;

              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              const count = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
              const prefKey = item.badgeKey
                ? badgeKeyToPref[item.badgeKey]
                : undefined;
              const showBadge =
                count > 0 && prefKey && badgePreferences[prefKey] !== false;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeSheet}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground active:bg-muted",
                  )}
                >
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1">{item.name}</span>
                  {showBadge && (
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium",
                        item.badgeKey === "followUp"
                          ? "bg-amber-500 text-white dark:bg-amber-600"
                          : "bg-primary text-primary-foreground",
                      )}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Divider + utility items */}
          <div className="border-t mx-4" />
          <div className="px-4 py-2">
            <Link
              href="/settings"
              onClick={closeSheet}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                pathname === "/settings"
                  ? "bg-primary/10 text-primary"
                  : "text-foreground active:bg-muted",
              )}
            >
              <Settings className="h-5 w-5 text-muted-foreground" />
              Settings
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={closeSheet}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-primary/10 text-primary"
                    : "text-foreground active:bg-muted",
                )}
              >
                <Shield className="h-5 w-5 text-muted-foreground" />
                Admin
              </Link>
            )}
            <button
              onClick={() => {
                closeSheet();
                signOut({ callbackUrl: "/login" });
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal text-foreground transition-colors active:bg-muted"
            >
              <LogOut className="h-5 w-5 text-muted-foreground" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
