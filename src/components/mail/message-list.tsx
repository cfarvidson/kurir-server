"use client";

import Link from "next/link";
import { formatDistanceToNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Paperclip } from "lucide-react";

interface Message {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
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
      {messages.map((message) => (
        <Link
          key={message.id}
          href={`/imbox/${message.id}`}
          className={cn(
            "flex items-start gap-4 border-b px-6 py-4 transition-colors hover:bg-muted/50",
            !message.isRead && "bg-primary/5"
          )}
        >
          {/* Avatar */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {(message.sender?.displayName || message.fromName || message.fromAddress)
              .charAt(0)
              .toUpperCase()}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "truncate text-sm",
                  !message.isRead && "font-semibold"
                )}
              >
                {message.sender?.displayName || message.fromName || message.fromAddress}
              </span>
              {message.hasAttachments && (
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
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
      ))}
    </div>
  );
}
