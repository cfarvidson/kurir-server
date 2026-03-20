"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

const listShortcuts: ShortcutEntry[] = [
  { keys: ["j"], description: "Next conversation" },
  { keys: ["k"], description: "Previous conversation" },
  { keys: ["Enter"], description: "Open conversation" },
  { keys: ["e"], description: "Archive" },
  { keys: ["s"], description: "Snooze" },
  { keys: ["x"], description: "Select / deselect" },
  { keys: ["Shift", "U"], description: "Toggle read / unread" },
  { keys: ["/"], description: "Search" },
  { keys: ["c"], description: "Compose" },
];

const threadShortcuts: ShortcutEntry[] = [
  { keys: ["r"], description: "Reply" },
  { keys: ["e"], description: "Archive" },
  { keys: ["s"], description: "Snooze" },
  { keys: ["j"], description: "Next thread" },
  { keys: ["k"], description: "Previous thread" },
  { keys: ["Shift", "U"], description: "Toggle read / unread" },
  { keys: ["Esc"], description: "Back to list" },
];

const composeShortcuts: ShortcutEntry[] = [
  { keys: ["Cmd", "Enter"], description: "Send" },
  { keys: ["Cmd", "Shift", "Enter"], description: "Schedule send" },
  { keys: ["Esc"], description: "Close" },
];

const navigationShortcuts: ShortcutEntry[] = [
  { keys: ["g", "i"], description: "Go to Imbox" },
  { keys: ["g", "f"], description: "Go to Feed" },
  { keys: ["g", "p"], description: "Go to Paper Trail" },
  { keys: ["g", "s"], description: "Go to Sent" },
  { keys: ["g", "a"], description: "Go to Archive" },
  { keys: ["g", "n"], description: "Go to Screener" },
  { keys: ["?"], description: "Keyboard shortcuts" },
];

function ShortcutGroup({
  title,
  shortcuts,
}: {
  title: string;
  shortcuts: ShortcutEntry[];
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </h3>
      <div className="space-y-1">
        {shortcuts.map(({ keys, description }) => (
          <div
            key={description}
            className="flex items-center justify-between py-0.5"
          >
            <span className="text-sm text-muted-foreground">{description}</span>
            <div className="flex gap-1">
              {keys.map((key, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
                    {key}
                  </kbd>
                  {i < keys.length - 1 && (
                    <span className="text-[10px] text-muted-foreground/50">
                      +
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
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
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <ShortcutGroup title="List view" shortcuts={listShortcuts} />
          <ShortcutGroup title="Thread view" shortcuts={threadShortcuts} />
          <ShortcutGroup title="Compose" shortcuts={composeShortcuts} />
          <ShortcutGroup title="Navigation" shortcuts={navigationShortcuts} />
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
          gTimerRef.current = setTimeout(() => {
            gPressedRef.current = false;
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
