"use client";

/**
 * FromPicker — dropdown to select which email connection to send from.
 * Used in compose and reply flows when the user has multiple connections.
 *
 * Design:
 * - Shows the currently selected connection's email address
 * - Clicking opens a popover with all connections listed
 * - Default connection is pre-selected and marked with a star
 * - If only one connection exists, renders as a plain text label (no interaction)
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { ChevronDown, Mail, Star } from "lucide-react";

export interface FromConnection {
  id: string;
  email: string;
  displayName: string | null;
  isDefault: boolean;
}

interface FromPickerProps {
  connections: FromConnection[];
  value: string; // selected connection id
  onChange: (id: string) => void;
  className?: string;
}

export function FromPicker({
  connections,
  value,
  onChange,
  className,
}: FromPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = connections.find((c) => c.id === value) ?? connections[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Single connection — no picker needed
  if (connections.length <= 1) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span>{selected?.email}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
          open && "bg-muted text-foreground",
        )}
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[200px] truncate">
          {selected?.displayName
            ? `${selected.displayName} <${selected.email}>`
            : selected?.email}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            aria-label="Select sender"
            className={cn(
              "absolute left-0 top-full z-50 mt-1",
              "min-w-[260px] overflow-hidden rounded-lg border bg-popover shadow-lg",
            )}
          >
            <div className="py-1">
              {connections.map((conn) => {
                const isSelected = conn.id === value;
                return (
                  <button
                    key={conn.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(conn.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                  >
                    {/* Avatar */}
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                      {(conn.displayName || conn.email).charAt(0).toUpperCase()}
                    </div>

                    {/* Labels */}
                    <div className="min-w-0 flex-1">
                      {conn.displayName ? (
                        <>
                          <div className="truncate font-medium">
                            {conn.displayName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {conn.email}
                          </div>
                        </>
                      ) : (
                        <div className="truncate">{conn.email}</div>
                      )}
                    </div>

                    {/* Default indicator */}
                    {conn.isDefault && (
                      <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
                    )}

                    {/* Selected checkmark */}
                    {isSelected && (
                      <svg
                        className="h-4 w-4 shrink-0 text-primary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
