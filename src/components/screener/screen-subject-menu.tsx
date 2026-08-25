"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  Loader2,
  Newspaper,
  Receipt,
  TextQuote,
  X,
} from "lucide-react";
import { createSubjectRule } from "@/actions/subject-rules";
import {
  subjectScopeOptions,
  type SubjectScopeOption,
} from "@/lib/mail/subject-rules";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SenderCategory } from "@prisma/client";

/** Display form of a scope option: `*.github.com` for the wildcard scope. */
function scopeLabel(option: SubjectScopeOption): string {
  return option.scope === "SUBDOMAINS"
    ? `*.${option.scopeValue}`
    : option.scopeValue;
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
 * "Screen subject" (kurir-ios#48): create a subject rule from an open
 * message. The pattern is pre-filled with the message's subject and editable;
 * the scope picker mirrors Screen domain (this sender / domain / *.domain).
 * Matching mail is filed by the rule; everything else from the sender keeps
 * following the sender's decision.
 */
export function ScreenSubjectMenu({
  senderId,
  senderEmail,
  defaultPattern,
}: {
  senderId: string;
  senderEmail: string;
  defaultPattern: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState(defaultPattern);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  const options = subjectScopeOptions(senderEmail);
  const trimmed = pattern.trim();

  const apply = (category: SenderCategory | null) => {
    const option = options[scopeIndex] ?? options[0];
    startTransition(async () => {
      await createSubjectRule(
        senderId,
        option.scope,
        option.scopeValue,
        trimmed,
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
          aria-label="Screen subject"
          title="Screen subject"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TextQuote className="h-4 w-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">
          Screen subject
        </div>
        <label
          htmlFor="screen-subject-pattern"
          className="mb-1 block text-xs text-muted-foreground"
        >
          Subject contains
        </label>
        <input
          id="screen-subject-pattern"
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          disabled={isPending}
          className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
        <label
          htmlFor="screen-subject-scope"
          className="mb-1 block text-xs text-muted-foreground"
        >
          From
        </label>
        <select
          id="screen-subject-scope"
          value={scopeIndex}
          onChange={(e) => setScopeIndex(Number(e.target.value))}
          disabled={isPending}
          className="mb-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {options.map((option, i) => (
            <option key={scopeLabel(option)} value={i}>
              {option.scope === "ADDRESS"
                ? option.scopeValue
                : `Everyone at ${scopeLabel(option)}`}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Deliver to</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => apply(c.value)}
                disabled={isPending || !trimmed}
                title={c.label}
                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <c.Icon className={`size-4 ${c.color}`} aria-hidden="true" />
              </button>
            ))}
            <button
              onClick={() => apply(null)}
              disabled={isPending || !trimmed}
              title="Screen out"
              className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
