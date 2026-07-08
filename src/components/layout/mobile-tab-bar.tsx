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
  Command,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import {
  navigation,
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
  replyLaterCount?: number;
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

// Primary destinations are pinned in the always-visible tab bar above.
const PRIMARY_TAB_HREFS = new Set(["/imbox", "/screener", "/feed"]);

// Everything else is surfaced in the "More" sheet. Deriving these from the
// shared `navigation` source (rather than a separate hardcoded list) keeps the
// mobile nav in parity with the desktop sidebar, so destinations like Files
// can't silently go missing on the PWA.
const moreItems = navigation.filter(
  (item) => !PRIMARY_TAB_HREFS.has(item.href),
);

const TRANSITION = "transform 0.3s cubic-bezier(0.2, 0, 0, 1)";

export function MobileTabBar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  scheduledCount = 0,
  followUpCount = 0,
  replyLaterCount = 0,
  badgePreferences = defaultBadgePreferences,
  isAdmin = false,
}: MobileTabBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  // Optimistic navigation target: highlight the tapped tab immediately
  // instead of waiting for the server render to commit the new pathname.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
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
    replyLaterCount,
  });

  // Close sheet and clear the optimistic highlight on route change
  useEffect(() => {
    setSheetOpen(false);
    setPendingHref(null);
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
          backdropRef.current.style.animation = "none";
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

  // Effective location: the optimistic target while a navigation is in
  // flight, the committed pathname otherwise.
  const activeHref = pendingHref ?? pathname;

  // Check if any "more" item is active (to highlight the More tab)
  const moreHrefs = [...moreItems.map((i) => i.href), "/settings", "/admin"];
  const isMoreActive = moreHrefs.some(
    (href) =>
      activeHref === href || (href !== "/" && activeHref.startsWith(href)),
  );

  return (
    <div className="md:hidden">
      {/* Tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur-xs pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch">
          {tabs.map((tab) => {
            const isActive = activeHref === tab.href;
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
                onClick={() => setPendingHref(tab.href)}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground",
                )}
              >
                <div className="relative">
                  <tab.icon className="h-5 w-5" />
                  {showBadge && (
                    <span className="absolute -right-2 -top-1.5 text-[9px] font-medium tabular-nums text-primary">
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
          className="fixed inset-0 z-50 bg-black animate-[fadeIn_0.2s_ease-out_forwards]"
          style={{ opacity: 0 }}
        />
      )}

      {/* Bottom sheet */}
      {sheetOpen && (
        <div
          ref={sheetRef}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-card shadow-overlay"
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
                activeHref === item.href ||
                (item.href !== "/" && activeHref.startsWith(item.href));
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
                  onClick={() => {
                    setPendingHref(item.href);
                    closeSheet();
                  }}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md py-2.5 pl-4 pr-3 text-sm font-normal transition-colors",
                    isActive
                      ? "font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
                      : "text-foreground active:bg-muted",
                  )}
                >
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1">{item.name}</span>
                  {showBadge && (
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        item.badgeKey === "followUp"
                          ? "text-amber-600 dark:text-amber-500"
                          : "text-primary",
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
              onClick={() => {
                setPendingHref("/settings");
                closeSheet();
              }}
              className={cn(
                "relative flex items-center gap-3 rounded-md py-2.5 pl-4 pr-3 text-sm font-normal transition-colors",
                activeHref === "/settings"
                  ? "font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
                  : "text-foreground active:bg-muted",
              )}
            >
              <Settings className="h-5 w-5 text-muted-foreground" />
              Settings
            </Link>
            <button
              onClick={() => {
                closeSheet();
                window.dispatchEvent(new CustomEvent("open-command-palette"));
              }}
              className="flex w-full items-center gap-3 rounded-md py-2.5 pl-4 pr-3 text-sm font-normal text-foreground transition-colors active:bg-muted"
            >
              <Command className="h-5 w-5 text-muted-foreground" />
              Commands
            </button>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => {
                  setPendingHref("/admin");
                  closeSheet();
                }}
                className={cn(
                  "relative flex items-center gap-3 rounded-md py-2.5 pl-4 pr-3 text-sm font-normal transition-colors",
                  activeHref.startsWith("/admin")
                    ? "font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
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
              className="flex w-full items-center gap-3 rounded-md py-2.5 pl-4 pr-3 text-sm font-normal text-foreground transition-colors active:bg-muted"
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
