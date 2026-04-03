"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
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

const DRAWER_WIDTH = 288; // w-72 = 18rem
const EDGE_ZONE = 20; // px from left edge to start open gesture
const OPEN_THRESHOLD = 0.3; // fraction of drawer width to snap open
const VELOCITY_THRESHOLD = 300; // px/s to snap open regardless of position
const DIRECTION_LOCK_DISTANCE = 10;
const TRANSITION = "transform 0.3s cubic-bezier(0.2, 0, 0, 1)";

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
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Mutable gesture state — no React re-renders during touch for 60fps
  const g = useRef({
    isOpen: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    tracking: false,
    direction: null as "horizontal" | "vertical" | null,
    lastX: 0,
    lastTime: 0,
  });

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
  const segments = pathname.split("/").filter(Boolean);
  const isSubPage = segments.length > 1;

  // Apply drawer position directly to DOM — no React state during gestures
  const applyPosition = useCallback((offsetX: number, animate: boolean) => {
    const drawer = drawerRef.current;
    const backdrop = backdropRef.current;
    if (!drawer || !backdrop) return;

    const progress = Math.max(0, Math.min(1, offsetX / DRAWER_WIDTH));
    const t = animate ? TRANSITION : "none";

    drawer.style.transition = t;
    drawer.style.transform = `translate3d(${-DRAWER_WIDTH + offsetX}px, 0, 0)`;

    backdrop.style.transition = animate
      ? "opacity 0.3s cubic-bezier(0.2, 0, 0, 1)"
      : "none";
    backdrop.style.opacity = String(progress * 0.4);
    backdrop.style.pointerEvents = progress > 0.01 ? "auto" : "none";
  }, []);

  const open = useCallback(() => {
    g.current.isOpen = true;
    applyPosition(DRAWER_WIDTH, true);
    document.body.style.overflow = "hidden";
  }, [applyPosition]);

  const close = useCallback(() => {
    g.current.isOpen = false;
    applyPosition(0, true);
    document.body.style.overflow = "";
  }, [applyPosition]);

  // Close on route change
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Edge-swipe gesture to open/close drawer
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const s = g.current;
      const touch = e.touches[0];
      s.startX = touch.clientX;
      s.startY = touch.clientY;
      s.currentX = touch.clientX;
      s.direction = null;
      s.lastX = touch.clientX;
      s.lastTime = Date.now();

      if (s.isOpen) {
        // When open, track from anywhere to allow swipe-to-close
        s.tracking = true;
      } else if (touch.clientX <= EDGE_ZONE) {
        // When closed, only track from the left edge
        s.tracking = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const s = g.current;
      if (!s.tracking) return;

      const touch = e.touches[0];
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;

      // Direction lock — decide horizontal vs vertical once
      if (s.direction === null) {
        const total = Math.abs(dx) + Math.abs(dy);
        if (total > DIRECTION_LOCK_DISTANCE) {
          s.direction = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        }
      }

      if (s.direction === "vertical") {
        s.tracking = false;
        return;
      }

      if (s.direction === "horizontal") {
        s.lastX = s.currentX;
        s.lastTime = Date.now();
        s.currentX = touch.clientX;

        const offsetX = s.isOpen ? DRAWER_WIDTH + dx : dx;
        applyPosition(Math.max(0, Math.min(DRAWER_WIDTH, offsetX)), false);
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      const s = g.current;
      if (!s.tracking || s.direction !== "horizontal") {
        s.tracking = false;
        return;
      }

      const dx = s.currentX - s.startX;
      const dt = Math.max(1, Date.now() - s.lastTime);
      const velocity = ((s.currentX - s.lastX) / dt) * 1000;

      let offsetX = s.isOpen ? DRAWER_WIDTH + dx : dx;
      offsetX = Math.max(0, Math.min(DRAWER_WIDTH, offsetX));

      const shouldOpen =
        velocity > VELOCITY_THRESHOLD ||
        (velocity > -VELOCITY_THRESHOLD &&
          offsetX > DRAWER_WIDTH * OPEN_THRESHOLD);

      if (shouldOpen) {
        open();
      } else {
        close();
      }

      s.tracking = false;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyPosition, open, close]);

  return (
    <div className="md:hidden">
      {/* Hamburger button — hidden on sub-pages that have their own back button */}
      {!isSubPage && (
        <button
          onClick={open}
          data-mobile-hamburger
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Backdrop — always rendered, controlled via opacity */}
      <div
        ref={backdropRef}
        onClick={close}
        className="fixed inset-0 z-50 bg-black"
        style={{ opacity: 0, pointerEvents: "none" }}
      />

      {/* Drawer — always rendered off-screen, translated in by gesture or open() */}
      <div
        ref={drawerRef}
        className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card shadow-2xl"
        style={{ transform: `translate3d(${-DRAWER_WIDTH}px, 0, 0)` }}
      >
        {/* Logo + close */}
        <div className="flex h-16 items-center justify-between border-b px-5">
          <div className="flex items-center gap-2">
            <KurirLogo className="h-8 w-8" />
            <span className="text-xl font-semibold">Kurir</span>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Compose */}
        <div className="p-4">
          <Link
            href="/compose"
            onClick={close}
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
            if (item.badgeKey === "scheduled" && badgeCounts.scheduled === 0)
              return null;

            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={close}
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
                  badgePreferences[badgeKeyToPref[item.badgeKey]] !== false && (
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
            onClick={close}
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
              onClick={close}
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
              close();
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
      </div>
    </div>
  );
}
