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
  ChevronRight,
} from "lucide-react";
import { showShortcuts } from "@/components/mail/keyboard-shortcuts";
import { KurirLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { SyncStatusIndicator } from "@/components/sync/SyncStatus";
import { useSync } from "@/hooks/useSync";
import { requestMailCheck } from "@/lib/mail/check-trigger";
import { useBadgeCounts } from "@/hooks/use-badge-counts";
import { useTodayEvents } from "@/hooks/use-today-events";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { normalizeEventHex } from "@/lib/calendar/color";
import { pickNextUp, todayRows } from "@/lib/calendar/next-up";
import {
  type BadgeKey,
  type BadgePreferences,
  type NavItem,
  type RailSection,
  badgeKeyToPref,
  defaultBadgePreferences,
  railSectionFor,
  railSections,
} from "./navigation";

interface SidebarProps {
  screenerCount?: number;
  imboxUnreadCount?: number;
  scheduledCount?: number;
  followUpCount?: number;
  replyLaterCount?: number;
  feedUnreadCount?: number;
  paperTrailUnreadCount?: number;
  badgePreferences?: BadgePreferences;
  isAdmin?: boolean;
  /** The user's IANA timezone; null falls back to the browser's. */
  timezone?: string | null;
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
  "/calendar": "E",
  "/screener": "N",
  "/sent": "S",
  "/archive": "A",
  "/follow-up": "U",
  "/reply-later": "R",
  "/snoozed": "Z",
  "/scheduled": "D",
  "/files": "L",
  "/contacts": "C",
};

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("open-command-palette"));
}

function isNavActive(pathname: string, href: string) {
  if (href === "/calendar") {
    return pathname === "/calendar" || pathname.startsWith("/calendar/");
  }
  return pathname === href;
}

function SidebarNavLink({
  item,
  pathname,
  badgeCounts,
  badgePreferences,
}: {
  item: NavItem;
  pathname: string;
  badgeCounts: Record<BadgeKey, number>;
  badgePreferences: BadgePreferences;
}) {
  const isActive = isNavActive(pathname, item.href);
  const shortcutKey = NAV_SHORTCUTS[item.href];
  const count = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
  const prefKey = item.badgeKey ? badgeKeyToPref[item.badgeKey] : undefined;
  const showBadge =
    prefKey !== undefined &&
    count > 0 &&
    badgePreferences[prefKey] !== false;

  return (
    <Link
      href={item.href}
      className={cn(
        "group/nav relative flex items-center gap-3 rounded-md py-1.5 pl-4 pr-3 text-sm font-normal transition-colors",
        isActive
          ? "font-medium text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <item.icon className="h-5 w-5" />
      <span className="flex-1">{item.name}</span>
      {showBadge ? (
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
}

export function Sidebar({
  screenerCount = 0,
  imboxUnreadCount = 0,
  scheduledCount = 0,
  followUpCount = 0,
  replyLaterCount = 0,
  feedUnreadCount = 0,
  paperTrailUnreadCount = 0,
  badgePreferences = defaultBadgePreferences,
  isAdmin = false,
  timezone = null,
}: SidebarProps) {
  const pathname = usePathname();
  const syncState = useSync();
  const timeZone =
    timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = useTodayEvents(timeZone);

  const badgeCounts = useBadgeCounts({
    screenerCount,
    imboxUnreadCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    scheduledCount,
    followUpCount,
    replyLaterCount,
  });

  const activeSection = railSectionFor(pathname);

  return (
    <div className="hidden h-full shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {/* Rail: one icon per part of Kurir. The panel beside it lists the
          active part's pages. shrink-0 on the fixed rows: in a short window
          the flex column would otherwise compress them. */}
      <nav
        aria-label="Apps"
        className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-muted/40 py-3"
      >
        <Link href="/imbox" aria-label="Kurir" className="mb-3 shrink-0">
          <KurirLogo className="h-9 w-9" />
        </Link>
        {railSections.map((section) => (
          <RailLink
            key={section.id}
            section={section}
            active={section.id === activeSection.id}
            badgeCounts={badgeCounts}
            badgePreferences={badgePreferences}
          />
        ))}
        <div className="flex-1" />
        <RailButton label="Commands" kbd="⌘K" onClick={openCommandPalette}>
          <Command className="h-5 w-5" />
        </RailButton>
        <RailButton label="Shortcuts" kbd="?" onClick={showShortcuts}>
          <Keyboard className="h-5 w-5" />
        </RailButton>
        <RailButton
          label="Settings"
          href="/settings"
          active={pathname === "/settings"}
        >
          <Settings className="h-5 w-5" />
        </RailButton>
        {isAdmin && (
          <RailButton
            label="Admin"
            href="/admin"
            active={pathname.startsWith("/admin")}
          >
            <Shield className="h-5 w-5" />
          </RailButton>
        )}
        <RailButton
          label="Sign out"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-5 w-5" />
        </RailButton>
      </nav>

      {/* Panel */}
      <div className="flex w-60 min-w-0 flex-col">
        <div className="flex h-16 shrink-0 items-center gap-2 px-5">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            {activeSection.name}
          </h2>
          <SyncStatusIndicator
            status={syncState.status}
            lastSyncTime={syncState.lastSyncTime}
            errorMessage={syncState.errorMessage}
            onClick={requestMailCheck}
          />
          <Button
            asChild
            size="icon"
            className="group ml-auto h-9 w-9"
            title="Compose (c)"
          >
            <Link
              href={`/compose?from=${encodeURIComponent(pathname)}`}
              aria-label="Compose"
            >
              <PenSquare className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <nav
          aria-label={activeSection.name}
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        >
          {activeSection.id === "mail" && (
            <NextUpCard
              instances={today.instances}
              now={today.now}
              timeZone={timeZone}
            />
          )}
          {activeSection.groups.map((group, index) => {
            const items = group.items.filter(
              (item) =>
                !(item.badgeKey === "scheduled" && badgeCounts.scheduled === 0),
            );
            if (items.length === 0) return null;

            const headingId = group.label
              ? `sidebar-nav-${group.id}`
              : undefined;

            return (
              <div
                key={group.id}
                className={cn(
                  index > 0 && "mt-3",
                  group.id === "archive" && "border-t border-sidebar-border pt-3",
                )}
                role={group.label ? "group" : undefined}
                aria-labelledby={headingId}
              >
                {group.label && (
                  <p
                    id={headingId}
                    className="eyebrow px-4 pb-0.5 text-muted-foreground"
                  >
                    {group.label}
                  </p>
                )}
                {items.map((item) => (
                  <SidebarNavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    badgeCounts={badgeCounts}
                    badgePreferences={badgePreferences}
                  />
                ))}
              </div>
            );
          })}
          {activeSection.id === "calendar" && (
            <TodayList
              instances={today.instances}
              now={today.now}
              timeZone={timeZone}
            />
          )}
        </nav>
      </div>
    </div>
  );
}

function RailLink({
  section,
  active,
  badgeCounts,
  badgePreferences,
}: {
  section: RailSection;
  active: boolean;
  badgeCounts: Record<BadgeKey, number>;
  badgePreferences: BadgePreferences;
}) {
  const count = section.badgeKey ? badgeCounts[section.badgeKey] : 0;
  const showBadge =
    section.badgeKey !== undefined &&
    count > 0 &&
    badgePreferences[badgeKeyToPref[section.badgeKey]] !== false;
  const shortcutKey = NAV_SHORTCUTS[section.href];

  return (
    <Link
      href={section.href}
      aria-current={active ? "page" : undefined}
      title={shortcutKey ? `${section.name} (G then ${shortcutKey})` : section.name}
      className={cn(
        "relative flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg border py-2 text-[10.5px] font-medium transition-colors",
        active
          ? "border-sidebar-border bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <section.icon className={cn("h-5 w-5", active && "text-primary")} />
      <span>{section.name}</span>
      {showBadge && (
        <span className="absolute right-1 top-0.5 text-[10px] font-semibold tabular-nums text-primary">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function RailButton({
  label,
  kbd,
  href,
  active = false,
  onClick,
  children,
}: {
  label: string;
  kbd?: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className = cn(
    "flex h-9 w-10 shrink-0 items-center justify-center rounded-md transition-colors",
    active
      ? "bg-background text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
  const title = kbd ? `${label} (${kbd})` : label;
  if (href) {
    return (
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        title={title}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className={className}
    >
      {children}
    </button>
  );
}

function NextUpCard({
  instances,
  now,
  timeZone,
}: {
  instances: CalendarInstanceDTO[];
  now: Date;
  timeZone: string;
}) {
  const next = pickNextUp(instances, now, timeZone);
  if (!next) return null;
  return (
    <Link
      href="/calendar"
      className="mb-3 flex items-center gap-3 rounded-lg border border-sidebar-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      <span
        aria-hidden
        className="h-8 w-1 shrink-0 rounded-xs"
        style={{ backgroundColor: normalizeEventHex(next.color) }}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="eyebrow text-muted-foreground">
          Next up{next.when ? ` · ${next.when}` : ""}
        </span>
        <span className="truncate text-sm font-medium">
          <span className="tabular-nums">{next.time}</span> {next.title}
        </span>
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function TodayList({
  instances,
  now,
  timeZone,
}: {
  instances: CalendarInstanceDTO[];
  now: Date;
  timeZone: string;
}) {
  const rows = todayRows(instances, now, timeZone);
  return (
    <div
      className="mt-3 border-t border-sidebar-border pt-3"
      role="group"
      aria-labelledby="sidebar-nav-today"
    >
      <p id="sidebar-nav-today" className="eyebrow px-4 pb-1 text-muted-foreground">
        Today
      </p>
      {rows.length === 0 ? (
        <p className="px-4 py-1.5 text-sm text-muted-foreground">
          Nothing today
        </p>
      ) : (
        rows.map((row) => (
          <Link
            key={row.key}
            href="/calendar"
            className={cn(
              "flex items-center gap-2.5 rounded-md py-1.5 pl-4 pr-3 text-sm transition-colors hover:bg-muted/50",
              row.isPast ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
              {row.time}
            </span>
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: normalizeEventHex(row.color) }}
            />
            <span className="truncate">{row.title}</span>
          </Link>
        ))
      )}
    </div>
  );
}
