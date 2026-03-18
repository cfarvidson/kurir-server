"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";

const shortcuts = [
  { keys: ["/"], description: "Search" },
  { keys: ["c"], description: "Compose" },
  { keys: ["e"], description: "Archive" },
  { keys: ["?"], description: "Keyboard shortcuts" },
  { keys: ["Esc"], description: "Clear / Close" },
] as const;

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
      <div className="relative w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {shortcuts.map(({ keys, description }) => (
            <div
              key={description}
              className="flex items-center justify-between py-1"
            >
              <span className="text-sm text-muted-foreground">
                {description}
              </span>
              <div className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-input bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
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
]);

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [showHelp, setShowHelp] = useState(false);

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

      switch (e.key) {
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
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  if (!showHelp) return null;

  return <ShortcutsDialog onClose={handleClose} />;
}
