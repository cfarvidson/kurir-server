"use client";

import Link from "next/link";
import { formatDistanceToNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import { Paperclip, MessageSquare } from "lucide-react";

interface Conversation {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadCount: number;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface ContactThreadListProps {
  conversations: Conversation[];
  contactName: string;
}

export function ContactThreadList({
  conversations,
  contactName,
}: ContactThreadListProps) {
  return (
    <div>
      <div className="px-4 py-3 text-xs font-medium text-muted-foreground/70 md:px-6">
        {conversations.length} conversation
        {conversations.length !== 1 ? "s" : ""}
      </div>
      {conversations.map((msg) => {
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
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {msg.threadCount}
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
