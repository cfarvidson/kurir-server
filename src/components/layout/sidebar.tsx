"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Settings, PenSquare, LogOut, Keyboard } from "lucide-react";
import { showShortcuts } from "@/components/mail/keyboard-shortcuts";
import { KurirLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { navigation } from "./navigation";

interface SidebarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
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

export function Sidebar({
  screenerCount = 0,
  imboxUnreadCount = 0,
}: SidebarProps) {
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

  // Reset deltas when server props change (router.refresh() completed)
  useEffect(() => {
    setDeltas({});
  }, [screenerCount, imboxUnreadCount]);

  const badgeCounts: Record<string, number> = {
    imbox: Math.max(0, imboxUnreadCount + (deltas.imbox ?? 0)),
    screener: Math.max(0, screenerCount + (deltas.screener ?? 0)),
  };

  return (
    <div className="hidden h-full w-64 flex-col border-r bg-card md:flex">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <KurirLogo className="h-8 w-8" />
        <span className="text-xl font-semibold">Kurir</span>
      </div>

      {/* Compose button */}
      <div className="p-4">
        <Button asChild className="w-full gap-2">
          <Link href="/compose">
            <PenSquare className="h-4 w-4" />
            Compose
          </Link>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.name}</span>
              {item.badgeKey && badgeCounts[item.badgeKey] > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
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
