"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Inbox, Loader2, Newspaper, Receipt, X } from "lucide-react";
import { createDomainRule } from "@/actions/domain-rules";
import {
  domainScopeOptions,
  type DomainScopeOption,
} from "@/lib/mail/domain-rules";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SenderCategory } from "@prisma/client";

/** Display form of a scope option: `*.github.com` for wildcard. */
function scopeLabel(option: DomainScopeOption): string {
  return option.includeSubdomains ? `*.${option.pattern}` : option.pattern;
}

const CATEGORIES = [
  { value: "IMBOX", label: "Imbox", Icon: Inbox, color: "text-imbox" },
  { value: "FEED", label: "The Feed", Icon: Newspaper, color: "text-feed" },
  {
    value: "PAPER_TRAIL",
    label: "Paper Trail",
    Icon: Receipt,
    color: "text-paper-trail",
  },
] as const;

/**
 * "Screen domain" (plan 034): create a domain rule from an existing sender.
 * One row per scope option with category / screen-out buttons; the origin
 * sender follows the rule server-side, matching PENDING senders are swept,
 * other decided senders are never touched.
 */
export function ScreenDomainMenu({
  senderId,
  domain,
}: {
  senderId: string;
  domain: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const apply = (
    option: DomainScopeOption,
    category: SenderCategory | null,
  ) => {
    startTransition(async () => {
      await createDomainRule(
        senderId,
        option.pattern,
        option.includeSubdomains,
        category ? "APPROVED" : "REJECTED",
        category ?? undefined,
      );
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Screen domain"
          title="Screen domain"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <AtSign className="h-4 w-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">
          Screen domain
        </div>
        <div className="space-y-1">
          {domainScopeOptions(domain).map((option) => (
            <div
              key={scopeLabel(option)}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1"
            >
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                Everyone at {scopeLabel(option)}
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => apply(option, c.value)}
                    disabled={isPending}
                    title={c.label}
                    className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <c.Icon className={`size-4 ${c.color}`} aria-hidden="true" />
                  </button>
                ))}
                <button
                  onClick={() => apply(option, null)}
                  disabled={isPending}
                  title="Screen out"
                  className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
