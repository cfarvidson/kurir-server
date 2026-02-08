"use client";

import Link from "next/link";
import { formatDistanceToNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Paperclip, MessageSquare } from "lucide-react";

interface Message {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadCount?: number;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div>
      {messages.map((message) => {
        const hasThread = (message.threadCount ?? 0) > 1;
        return (
          <Link
            key={message.id}
            href={`/imbox/${message.id}`}
            className={cn(
              "flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
              !message.isRead && "bg-primary/5"
            )}
          >
            {/* Avatar */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary md:h-10 md:w-10">
              {(message.sender?.displayName || message.fromName || message.fromAddress)
                .charAt(0)
                .toUpperCase()}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 md:gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    !message.isRead && "font-semibold"
                  )}
                >
                  {message.sender?.displayName || message.fromName || message.fromAddress}
                </span>
                {hasThread && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {message.threadCount}
                  </span>
                )}
                {message.hasAttachments && (
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                  {formatDistanceToNow(new Date(message.receivedAt))}
                </span>
              </div>
              <div
                className={cn(
                  "truncate text-sm",
                  !message.isRead ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {message.subject || "(no subject)"}
              </div>
              {message.snippet && (
                <div className="truncate text-sm text-muted-foreground">
                  {message.snippet}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
