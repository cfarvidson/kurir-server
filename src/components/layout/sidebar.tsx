"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Settings,
  PenSquare,
  LogOut,
  Keyboard,
  Command,
  Shield,
} from "lucide-react";
import { showShortcuts } from "@/components/mail/keyboard-shortcuts";
import { KurirLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { navigation } from "./navigation";
import { SyncStatusIndicator } from "@/components/sync/SyncStatus";
import { useSync } from "@/hooks/useSync";
import { useBadgeCounts } from "@/hooks/use-badge-counts";
import {
  type BadgePreferences,
  badgeKeyToPref,
  defaultBadgePreferences,
} from "./navigation";

interface SidebarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
  scheduledCount?: number;
  followUpCount?: number;
  feedUnreadCount?: number;
  paperTrailUnreadCount?: number;
  badgePreferences?: BadgePreferences;
  isAdmin?: boolean;
}

/**
 * Dispatch from anywhere to optimistically adjust a sidebar badge.
 * Example: badgeUpdate("screener", -1)
 */
export function badgeUpdate(key: string, delta: number) {
  window.dispatchEvent(
    new CustomEvent("badge-count-update", { detail: { key, delta } }),
  );
}

/** Maps nav href → keyboard shortcut key for g+X sequence */
const NAV_SHORTCUTS: Record<string, string> = {
  "/imbox": "I",
  "/feed": "F",
  "/paper-trail": "P",
  "/screener": "N",
  "/sent": "S",
  "/archive": "A",
  "/follow-up": "U",
  "/snoozed": "Z",
  "/scheduled": "D",
  "/contacts": "C",
};

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("open-command-palette"));
}

export function Sidebar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  scheduledCount = 0,
  followUpCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  badgePreferences = defaultBadgePreferences,
  isAdmin = false,
}: SidebarProps) {
  const pathname = usePathname();
  const syncState = useSync();

  const badgeCounts = useBadgeCounts({
    screenerCount,
    imboxUnreadCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    scheduledCount,
    followUpCount,
  });

  return (
    <div className="hidden h-full w-64 flex-col border-r bg-card md:flex">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <KurirLogo className="h-8 w-8" />
        <span className="text-xl font-semibold">Kurir</span>
        <div className="ml-auto">
          <SyncStatusIndicator
            status={syncState.status}
            lastSyncTime={syncState.lastSyncTime}
            errorMessage={syncState.errorMessage}
          />
        </div>
      </div>

      {/* Compose button */}
      <div className="p-4">
        <Button asChild className="group w-full">
          <Link href="/compose">
            <PenSquare className="h-4 w-4" />
            <span className="flex-1 text-left">Compose</span>
            <span className="font-mono text-xs text-primary-foreground/0 transition-opacity duration-200 group-hover:text-primary-foreground/40">
              c
            </span>
          </Link>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {navigation.map((item) => {
          // Hide Scheduled when there are no pending scheduled messages
          if (item.badgeKey === "scheduled" && badgeCounts.scheduled === 0)
            return null;

          const isActive = pathname === item.href;
          const shortcutKey = NAV_SHORTCUTS[item.href];
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group/nav flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.name}</span>
              {item.badgeKey &&
              badgeCounts[item.badgeKey] > 0 &&
              badgePreferences[badgeKeyToPref[item.badgeKey]] !== false ? (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium",
                    item.badgeKey === "followUp"
                      ? "bg-amber-500 text-white dark:bg-amber-600"
                      : "bg-primary text-primary-foreground",
                  )}
                >
                  {badgeCounts[item.badgeKey] > 99
                    ? "99+"
                    : badgeCounts[item.badgeKey]}
                </span>
              ) : shortcutKey ? (
                <span className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover/nav:opacity-100 lg:inline-flex">
                  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground/60">
                    G
                  </kbd>
                  <span className="text-[9px] text-muted-foreground/30">›</span>
                  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground/60">
                    {shortcutKey}
                  </kbd>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal transition-colors",
            pathname === "/settings"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Shield className="h-5 w-5" />
            Admin
          </Link>
        )}
        <button
          onClick={openCommandPalette}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Command className="h-5 w-5" />
          <span className="flex-1 text-left">Commands</span>
          <span className="inline-flex items-center gap-0.5">
            <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘
            </kbd>
            <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              K
            </kbd>
          </span>
        </button>
        <button
          onClick={showShortcuts}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Keyboard className="h-5 w-5" />
          <span className="flex-1 text-left">Shortcuts</span>
          <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            ?
          </kbd>
        </button>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
