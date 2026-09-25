"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An email address the user can select, with a one-click copy button that
 * briefly turns into a checkmark. Used wherever a person's address shows.
 */
export function CopyableAddress({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate select-text">{address}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard
            .writeText(address)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        aria-label={copied ? "Copied" : "Copy email address"}
        title="Copy email address"
      >
        {copied ? (
          <Check className="h-3 w-3 text-primary" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </span>
  );
}
