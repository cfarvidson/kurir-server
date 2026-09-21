"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { PERSON_PANE_SECTION_KEY_PREFIX } from "@/lib/mail/person-pane";
import { cn } from "@/lib/utils";

/**
 * Open state of a person pane section, remembered per browser. Starts
 * closed on both server and client and reads localStorage after mount,
 * like `hydrateCollapsed`, so SSR markup matches.
 */
export function usePaneSectionOpen(name: string): [boolean, () => void] {
  const key = `${PERSON_PANE_SECTION_KEY_PREFIX}${name}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(key) === "1");
    } catch {
      // Storage unavailable: stay closed.
    }
  }, [key]);

  const toggle = () => {
    const next = !open;
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Private mode / blocked storage: the toggle still works for the tab.
    }
    setOpen(next);
  };

  return [open, toggle];
}

/**
 * A collapsible pane section: chevron, eyebrow title, count on the right.
 * `forceOpen` shows the content (e.g. while the profile search has
 * matches) without touching the stored value.
 */
export function PaneDisclosure({
  name,
  title,
  count,
  forceOpen = false,
  className,
  children,
}: {
  name: string;
  title: string;
  count?: number;
  forceOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [stored, toggle] = usePaneSectionOpen(name);
  const open = stored || forceOpen;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="eyebrow">{title}</span>
        {count !== undefined && (
          <span className="ml-auto text-[11px] tabular-nums">{count}</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
