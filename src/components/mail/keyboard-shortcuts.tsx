"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { keyboardState } from "@/lib/keyboard-state";

interface ShortcutEntry {
  keys: string[];
  description: string;
  /** "combo" = press together (Shift+U), "sequence" = press in order (g then i) */
  mode?: "combo" | "sequence";
}

const listShortcuts: ShortcutEntry[] = [
  { keys: ["j"], description: "Next conversation" },
  { keys: ["k"], description: "Previous conversation" },
  { keys: ["Enter"], description: "Open conversation" },
  { keys: ["e"], description: "Archive" },
  { keys: ["s"], description: "Snooze" },
  { keys: ["f"], description: "Follow up" },
  { keys: ["x"], description: "Select / deselect" },
  { keys: ["Shift", "U"], description: "Toggle read / unread", mode: "combo" },
  { keys: ["/"], description: "Search" },
  { keys: ["c"], description: "Compose" },
];

const threadShortcuts: ShortcutEntry[] = [
  { keys: ["r"], description: "Reply" },
  { keys: ["j"], description: "Next thread" },
  { keys: ["k"], description: "Previous thread" },
  { keys: ["Esc"], description: "Back to list" },
];

const composeShortcuts: ShortcutEntry[] = [
  { keys: ["Cmd", "Enter"], description: "Send", mode: "combo" },
  {
    keys: ["Cmd", "Shift", "Enter"],
    description: "Schedule send",
    mode: "combo",
  },
  { keys: ["Esc"], description: "Close" },
];

const navigationShortcuts: ShortcutEntry[] = [
  { keys: ["g", "i"], description: "Imbox", mode: "sequence" },
  { keys: ["g", "f"], description: "Feed", mode: "sequence" },
  { keys: ["g", "p"], description: "Paper Trail", mode: "sequence" },
  { keys: ["g", "s"], description: "Sent", mode: "sequence" },
  { keys: ["g", "a"], description: "Archive", mode: "sequence" },
  { keys: ["g", "n"], description: "Screener", mode: "sequence" },
  { keys: ["g", "u"], description: "Follow Up", mode: "sequence" },
];

const screenerShortcuts: ShortcutEntry[] = [
  { keys: ["y"], description: "Screen in" },
  { keys: ["n"], description: "Screen out" },
  { keys: ["h"], description: "Skip (snooze)" },
  { keys: ["1"], description: "Categorize → Imbox" },
  { keys: ["2"], description: "Categorize → Feed" },
  { keys: ["3"], description: "Categorize → Paper Trail" },
  { keys: ["Space"], description: "Toggle email preview" },
  { keys: ["Esc"], description: "Close preview / picker" },
];

const sharedShortcuts: ShortcutEntry[] = [
  { keys: ["e"], description: "Archive" },
  { keys: ["s"], description: "Snooze" },
  { keys: ["f"], description: "Follow up" },
  { keys: ["Shift", "U"], description: "Toggle read / unread", mode: "combo" },
  { keys: ["Cmd", "K"], description: "Command palette", mode: "combo" },
  { keys: ["?"], description: "Keyboard shortcuts" },
];

function Keys({ keys, mode }: { keys: string[]; mode?: "combo" | "sequence" }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-border/80 bg-muted/60 px-1.5 font-mono text-[11px] font-medium leading-none text-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
            {key}
          </kbd>
          {i < keys.length - 1 &&
            (mode === "sequence" ? (
              <span className="px-0.5 text-[10px] text-muted-foreground/40">
                ›
              </span>
            ) : (
              <span className="px-0.5 text-[10px] text-muted-foreground/40">
                +
              </span>
            ))}
        </span>
      ))}
    </span>
  );
}

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[3px]">
      <span className="text-[13px] text-muted-foreground">
        {entry.description}
      </span>
      <Keys keys={entry.keys} mode={entry.mode} />
    </div>
  );
}

function ShortcutGroup({
  title,
  shortcuts,
}: {
  title: string;
  shortcuts: ShortcutEntry[];
}) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {title}
      </h3>
      <div>
        {shortcuts.map((entry) => (
          <ShortcutRow key={entry.description} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-[580px] rounded-xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — two-column grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 px-5 py-4">
          {/* Left column */}
          <div className="space-y-4">
            <ShortcutGroup title="List view" shortcuts={listShortcuts} />
            <ShortcutGroup title="Screener" shortcuts={screenerShortcuts} />
            <ShortcutGroup title="Thread view" shortcuts={threadShortcuts} />
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <ShortcutGroup title="Go to" shortcuts={navigationShortcuts} />
            <ShortcutGroup title="Compose" shortcuts={composeShortcuts} />
            <ShortcutGroup title="Anywhere" shortcuts={sharedShortcuts} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dispatch from anywhere to open the shortcuts dialog. */
export function showShortcuts() {
  window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));
}

const LISTING_PATHS = new Set([
  "/imbox",
  "/feed",
  "/paper-trail",
  "/screener",
  "/archive",
  "/sent",
  "/snoozed",
  "/follow-up",
]);

const GOTO_MAP: Record<string, string> = {
  i: "/imbox",
  f: "/feed",
  p: "/paper-trail",
  s: "/sent",
  a: "/archive",
  n: "/screener",
  u: "/follow-up",
};

const GOTO_TIMEOUT = 1000;

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [showHelp, setShowHelp] = useState(false);
  const gPressedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => setShowHelp(false), []);

  // Listen for programmatic open (e.g. from sidebar button)
  useEffect(() => {
    const handler = () => setShowHelp(true);
    window.addEventListener("show-keyboard-shortcuts", handler);
    return () => window.removeEventListener("show-keyboard-shortcuts", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      )
        return;

      // Handle second key of g+X sequence
      if (gPressedRef.current) {
        gPressedRef.current = false;
        keyboardState.gSequenceActive = false;
        if (gTimerRef.current) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        const target = GOTO_MAP[e.key];
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        return;
      }

      switch (e.key) {
        case "g":
          // Start go-to sequence
          e.preventDefault();
          gPressedRef.current = true;
          keyboardState.gSequenceActive = true;
          gTimerRef.current = setTimeout(() => {
            gPressedRef.current = false;
            keyboardState.gSequenceActive = false;
          }, GOTO_TIMEOUT);
          break;

        case "c":
          if (LISTING_PATHS.has(pathname)) {
            e.preventDefault();
            router.push("/compose");
          }
          break;

        case "?":
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (gTimerRef.current) clearTimeout(gTimerRef.current);
    };
  }, [router, pathname]);

  if (!showHelp) return null;

  return <ShortcutsDialog onClose={handleClose} />;
}
