"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import { listLabelForSearchHit } from "@/lib/mail/list-contract";
import { threadIsDirect } from "@/lib/mail/person-pane";
import { usePersonPaneStore } from "@/stores/person-pane-store";
import { Paperclip } from "lucide-react";

interface Conversation {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadCount: number;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  isSnoozed?: boolean;
  isFollowUp?: boolean;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface ContactThreadListProps {
  conversations: Conversation[];
  contactName: string;
  /** This person's addresses, for the Direct only filter. */
  personEmails: string[];
}

export function ContactThreadList({
  conversations,
  contactName,
  personEmails,
}: ContactThreadListProps) {
  const ownEmails = usePersonPaneStore((s) => s.ownEmails);
  const [directOnly, setDirectOnly] = useState(false);
  // Direct: only this person (any of their addresses) and us on the thread.
  const shown = directOnly
    ? conversations.filter((msg) =>
        personEmails.some((email) =>
          threadIsDirect(msg, email, [...ownEmails, ...personEmails]),
        ),
      )
    : conversations;
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 md:px-6">
        <span className="text-xs font-medium text-muted-foreground/70">
          {shown.length} conversation
          {shown.length !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          onClick={() => setDirectOnly((v) => !v)}
          className="text-[11px] font-medium text-primary"
        >
          {directOnly ? "All" : "Direct only"}
        </button>
      </div>
      {shown.length === 0 && (
        <p className="px-4 text-xs text-muted-foreground md:px-6">
          No direct conversations.
        </p>
      )}
      {shown.map((msg) => {
        const hasThread = msg.threadCount > 1;
        return (
          <Link
            key={msg.id}
            href={`${getThreadRoute(msg)}/${msg.id}`}
            className={cn(
              "flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
              !msg.isRead && "bg-primary/5",
            )}
          >
            <div className="min-w-0 flex-1">
              {listLabelForSearchHit(msg) && (
                <p className="eyebrow mb-0.5 text-muted-foreground">
                  {listLabelForSearchHit(msg)}
                </p>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    !msg.isRead && "font-semibold",
                  )}
                >
                  {msg.subject || "(no subject)"}
                </span>
                {hasThread && (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    ·{msg.threadCount}
                  </span>
                )}
                {msg.hasAttachments && (
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className="ml-auto shrink-0 text-xs text-muted-foreground"
                  suppressHydrationWarning
                >
                  {formatDistanceToNow(new Date(msg.receivedAt))}
                </span>
              </div>
              {msg.snippet && (
                <div className="mt-0.5 truncate text-sm text-muted-foreground">
                  {msg.snippet}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
