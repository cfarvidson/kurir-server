"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { senderInitial } from "@/lib/mail/thread-card";
import { cn } from "@/lib/utils";

/**
 * A name in a thread card that opens a small person card: who it is, the
 * address (selectable), and Copy address / Email.
 */
export function PersonCardPopover({
  name,
  address,
  children,
  className,
}: {
  name: string | null;
  address: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const secondary =
    "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={address}
          // The card header toggles on click; the name opens the card.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "cursor-pointer underline decoration-muted-foreground/30 underline-offset-[3px] hover:decoration-foreground",
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] p-3.5"
        // Portalled, but React still bubbles to the card header.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-muted-foreground">
            {senderInitial(address, name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name || address}</p>
            <p className="truncate text-xs text-muted-foreground select-text">
              {address}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                .writeText(address)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy address"}
          </button>
          <Link
            href={`/compose?to=${encodeURIComponent(address)}&from=${encodeURIComponent(pathname ?? "/imbox")}`}
            className={secondary}
            onClick={() => setOpen(false)}
          >
            Email
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
