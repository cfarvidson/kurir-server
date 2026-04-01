"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Command } from "cmdk";
import {
  Archive,
  Clock,
  Inbox,
  Newspaper,
  Receipt,
  Filter,
  Send,
  PenSquare,
  Search,
  Bell,
  CalendarClock,
  BookUser,
  Keyboard,
  Reply,
  Mail,
  MailOpen,
} from "lucide-react";
import { keyboardState } from "@/lib/keyboard-state";
import { showShortcuts } from "@/components/mail/keyboard-shortcuts";

/** Centralized action registry — single source of truth for all actions. */
export interface PaletteAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string[];
  group: "navigation" | "actions" | "compose";
  /** Only show when pathname matches one of these (undefined = always) */
  when?: string[] | ((pathname: string) => boolean);
  onSelect: () => void;
}

const LISTING_PATHS = [
  "/imbox",
  "/feed",
  "/paper-trail",
  "/screener",
  "/archive",
  "/sent",
  "/snoozed",
  "/follow-up",
  "/scheduled",
  "/contacts",
];

function isListingPath(p: string) {
  return LISTING_PATHS.some((lp) => p === lp || p.startsWith(lp + "?"));
}

function isThreadPath(p: string) {
  return LISTING_PATHS.some(
    (lp) => p.startsWith(lp + "/") && p !== lp && !p.startsWith(lp + "?"),
  );
}

function KbdBadge({ keys }: { keys: string[] }) {
  return (
    <span className="ml-auto hidden items-center gap-0.5 md:inline-flex">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[4px] border border-border/60 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const go = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [close, router],
  );

  const dispatch = useCallback(
    (event: string) => {
      close();
      window.dispatchEvent(new CustomEvent(event));
    },
    [close],
  );

  const actions: PaletteAction[] = [
    // Navigation
    {
      id: "go-imbox",
      label: "Go to Imbox",
      icon: <Inbox className="h-4 w-4" />,
      shortcut: ["G", "I"],
      group: "navigation",
      onSelect: () => go("/imbox"),
    },
    {
      id: "go-feed",
      label: "Go to Feed",
      icon: <Newspaper className="h-4 w-4" />,
      shortcut: ["G", "F"],
      group: "navigation",
      onSelect: () => go("/feed"),
    },
    {
      id: "go-paper-trail",
      label: "Go to Paper Trail",
      icon: <Receipt className="h-4 w-4" />,
      shortcut: ["G", "P"],
      group: "navigation",
      onSelect: () => go("/paper-trail"),
    },
    {
      id: "go-screener",
      label: "Go to Screener",
      icon: <Filter className="h-4 w-4" />,
      shortcut: ["G", "N"],
      group: "navigation",
      onSelect: () => go("/screener"),
    },
    {
      id: "go-sent",
      label: "Go to Sent",
      icon: <Send className="h-4 w-4" />,
      shortcut: ["G", "S"],
      group: "navigation",
      onSelect: () => go("/sent"),
    },
    {
      id: "go-archive",
      label: "Go to Archive",
      icon: <Archive className="h-4 w-4" />,
      shortcut: ["G", "A"],
      group: "navigation",
      onSelect: () => go("/archive"),
    },
    {
      id: "go-snoozed",
      label: "Go to Snoozed",
      icon: <Clock className="h-4 w-4" />,
      shortcut: ["G", "Z"],
      group: "navigation",
      onSelect: () => go("/snoozed"),
    },
    {
      id: "go-follow-up",
      label: "Go to Follow Up",
      icon: <Bell className="h-4 w-4" />,
      shortcut: ["G", "U"],
      group: "navigation",
      onSelect: () => go("/follow-up"),
    },
    {
      id: "go-scheduled",
      label: "Go to Scheduled",
      icon: <CalendarClock className="h-4 w-4" />,
      shortcut: ["G", "D"],
      group: "navigation",
      onSelect: () => go("/scheduled"),
    },
    {
      id: "go-contacts",
      label: "Go to Contacts",
      icon: <BookUser className="h-4 w-4" />,
      shortcut: ["G", "C"],
      group: "navigation",
      onSelect: () => go("/contacts"),
    },
    // Actions
    {
      id: "archive",
      label: "Archive conversation",
      icon: <Archive className="h-4 w-4" />,
      shortcut: ["E"],
      group: "actions",
      when: (p) => isListingPath(p) || isThreadPath(p),
      onSelect: () => {
        close();
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "e", bubbles: true }),
        );
      },
    },
    {
      id: "snooze",
      label: "Snooze conversation",
      icon: <Clock className="h-4 w-4" />,
      shortcut: ["S"],
      group: "actions",
      when: (p) => isListingPath(p) || isThreadPath(p),
      onSelect: () => {
        close();
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "s", bubbles: true }),
        );
      },
    },
    {
      id: "follow-up",
      label: "Follow up on conversation",
      icon: <Bell className="h-4 w-4" />,
      shortcut: ["F"],
      group: "actions",
      when: (p) => isListingPath(p) || isThreadPath(p),
      onSelect: () => {
        close();
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", bubbles: true }),
        );
      },
    },
    {
      id: "reply",
      label: "Reply",
      icon: <Reply className="h-4 w-4" />,
      shortcut: ["R"],
      group: "actions",
      when: (p) => isThreadPath(p),
      onSelect: () => dispatch("keyboard-reply"),
    },
    {
      id: "toggle-read",
      label: "Toggle read / unread",
      icon: <MailOpen className="h-4 w-4" />,
      shortcut: ["Shift", "U"],
      group: "actions",
      when: (p) => isListingPath(p),
      onSelect: () => {
        close();
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "U",
            shiftKey: true,
            bubbles: true,
          }),
        );
      },
    },
    {
      id: "search",
      label: "Search emails",
      icon: <Search className="h-4 w-4" />,
      shortcut: ["/"],
      group: "actions",
      when: (p) => isListingPath(p),
      onSelect: () => {
        close();
        // Focus the search input after closing
        requestAnimationFrame(() => {
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[type="search"], input[placeholder*="Search"]',
          );
          searchInput?.focus();
        });
      },
    },
    {
      id: "show-shortcuts",
      label: "Keyboard shortcuts",
      icon: <Keyboard className="h-4 w-4" />,
      shortcut: ["?"],
      group: "actions",
      onSelect: () => {
        close();
        showShortcuts();
      },
    },
    // Compose
    {
      id: "compose",
      label: "Compose new email",
      icon: <PenSquare className="h-4 w-4" />,
      shortcut: ["C"],
      group: "compose",
      onSelect: () => go("/compose"),
    },
  ];

  // Filter actions by context
  const filteredActions = actions.filter((a) => {
    if (!a.when) return true;
    if (typeof a.when === "function") return a.when(pathname);
    return a.when.some((p) => pathname.startsWith(p));
  });

  const groups = {
    navigation: filteredActions.filter((a) => a.group === "navigation"),
    actions: filteredActions.filter((a) => a.group === "actions"),
    compose: filteredActions.filter((a) => a.group === "compose"),
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={close}
      />

      {/* Palette */}
      <Command
        className="relative w-full max-w-[520px] overflow-hidden rounded-xl border bg-card shadow-2xl"
        loop
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="flex items-center border-b px-4">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Command.Input
            ref={inputRef}
            placeholder="Type a command or search..."
            className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-[320px] overflow-y-auto overscroll-contain p-1.5">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          {groups.compose.length > 0 && (
            <Command.Group
              heading="Compose"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/50"
            >
              {groups.compose.map((action) => (
                <Command.Item
                  key={action.id}
                  value={action.label}
                  onSelect={action.onSelect}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                >
                  <span className="text-muted-foreground">{action.icon}</span>
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && <KbdBadge keys={action.shortcut} />}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {groups.actions.length > 0 && (
            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/50"
            >
              {groups.actions.map((action) => (
                <Command.Item
                  key={action.id}
                  value={action.label}
                  onSelect={action.onSelect}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                >
                  <span className="text-muted-foreground">{action.icon}</span>
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && <KbdBadge keys={action.shortcut} />}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {groups.navigation.length > 0 && (
            <Command.Group
              heading="Navigation"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/50"
            >
              {groups.navigation.map((action) => (
                <Command.Item
                  key={action.id}
                  value={action.label}
                  onSelect={action.onSelect}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-foreground aria-selected:bg-primary/10 aria-selected:text-primary"
                >
                  <span className="text-muted-foreground">{action.icon}</span>
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && <KbdBadge keys={action.shortcut} />}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
