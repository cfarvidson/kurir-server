"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Menu,
  X,
  Settings,
  PenSquare,
  LogOut,
  Keyboard,
  Shield,
} from "lucide-react";
import { showShortcuts } from "@/components/mail/keyboard-shortcuts";
import { KurirLogo } from "@/components/logo";
import {
  navigation,
  type BadgePreferences,
  badgeKeyToPref,
  defaultBadgePreferences,
} from "./navigation";

interface MobileSidebarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
  scheduledCount?: number;
  followUpCount?: number;
  feedUnreadCount?: number;
  paperTrailUnreadCount?: number;
  badgePreferences?: BadgePreferences;
  isAdmin?: boolean;
}

export function MobileSidebar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  scheduledCount = 0,
  followUpCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  badgePreferences = defaultBadgePreferences,
  isAdmin = false,
}: MobileSidebarProps) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
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
  }, [
    screenerCount,
    imboxUnreadCount,
    scheduledCount,
    followUpCount,
    feedUnreadCount,
    paperTrailUnreadCount,
  ]);

  const badgeCounts: Record<string, number> = {
    imbox: Math.max(0, imboxUnreadCount + (deltas.imbox ?? 0)),
    screener: Math.max(0, screenerCount + (deltas.screener ?? 0)),
    scheduled: Math.max(0, scheduledCount + (deltas.scheduled ?? 0)),
    followUp: Math.max(0, followUpCount + (deltas.followUp ?? 0)),
    feed: Math.max(0, feedUnreadCount + (deltas.feed ?? 0)),
    paperTrail: Math.max(0, paperTrailUnreadCount + (deltas.paperTrail ?? 0)),
  };

  // Hide hamburger on detail/sub-pages that have their own back button
  // e.g. /imbox/abc123 or /contacts/abc123
  const segments = pathname.split("/").filter(Boolean);
  const isSubPage = segments.length > 1;

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      {/* Hamburger button — hidden on sub-pages that have their own back button */}
      {!isSubPage && (
        <button
          onClick={() => setOpen(true)}
          data-mobile-hamburger
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Drawer overlay */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            />

            {/* Drawer */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card shadow-2xl"
            >
              {/* Logo + close */}
              <div className="flex h-16 items-center justify-between border-b px-5">
                <div className="flex items-center gap-2">
                  <KurirLogo className="h-8 w-8" />
                  <span className="text-xl font-semibold">Kurir</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Compose */}
              <div className="p-4">
                <Link
                  href="/compose"
                  onClick={() => setOpen(false)}
                  className="group flex w-full items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <PenSquare className="h-4 w-4" />
                  <span className="flex-1">Compose</span>
                  <span className="font-mono text-xs text-primary-foreground/0 transition-opacity duration-200 group-hover:text-primary-foreground/40">
                    c
                  </span>
                </Link>
              </div>

              {/* Navigation */}
              <nav className="flex-1 space-y-0.5 overflow-auto px-3">
                {navigation.map((item) => {
                  // Hide Scheduled when there are no pending scheduled messages
                  if (
                    item.badgeKey === "scheduled" &&
                    badgeCounts.scheduled === 0
                  )
                    return null;

                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="flex-1">{item.name}</span>
                      {item.badgeKey &&
                        badgeCounts[item.badgeKey] > 0 &&
                        badgePreferences[badgeKeyToPref[item.badgeKey]] !==
                          false && (
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
                        )}
                    </Link>
                  );
                })}
              </nav>

              {/* Footer */}
              <div className="border-t p-3">
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
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
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
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
                  onClick={() => {
                    setOpen(false);
                    showShortcuts();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Keyboard className="h-5 w-5" />
                  <span className="flex-1 text-left">Shortcuts</span>
                  <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                    ?
                  </kbd>
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <LogOut className="h-5 w-5" />
                  Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
