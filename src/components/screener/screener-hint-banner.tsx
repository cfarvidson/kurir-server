"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Keyboard, X } from "lucide-react";

const STORAGE_KEY = "kurir:screener-shortcuts-dismissed";

function InlineKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-flex h-4 min-w-[16px] items-center justify-center rounded border border-border/70 bg-card px-1 font-mono text-[10px] font-medium leading-none shadow-[0_1px_0_0_hsl(var(--border))]"
    >
      {children}
    </kbd>
  );
}

export function ScreenerHintBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  }, []);

  // Listen for programmatic dismiss (from keyboard handler)
  useEffect(() => {
    const handler = () => dismiss();
    window.addEventListener("screener-hint-dismiss", handler);
    return () => window.removeEventListener("screener-hint-dismiss", handler);
  }, [dismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="hidden overflow-hidden md:block"
        >
          <div className="flex items-center gap-4 border-b border-border px-4 py-3 md:px-6">
            <span
              className="eyebrow flex shrink-0 items-center gap-1.5 text-muted-foreground"
              aria-hidden="true"
            >
              <Keyboard className="h-3.5 w-3.5" />
              Shortcuts
            </span>
            <span className="flex-1 text-sm text-muted-foreground">
              <InlineKey>Y</InlineKey> screen in &middot;{" "}
              <InlineKey>N</InlineKey> screen out &middot;{" "}
              <InlineKey>H</InlineKey> skip &middot;{" "}
              <InlineKey>Space</InlineKey> preview
            </span>
            <button
              onClick={dismiss}
              className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Dismiss keyboard hint"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Call this to dismiss the banner programmatically (e.g. on first shortcut use). */
export function dismissScreenerHint() {
  localStorage.setItem(STORAGE_KEY, "true");
  window.dispatchEvent(new CustomEvent("screener-hint-dismiss"));
}
