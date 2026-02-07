"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { ChevronDown, Paperclip } from "lucide-react";

interface ThreadMessage {
  id: string;
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
  sentAt: Date | null;
  textBody: string | null;
  htmlBody: string | null;
  isRead: boolean;
  isAnswered: boolean;
  snippet: string | null;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
  attachments: {
    id: string;
    filename: string;
    size: number;
  }[];
}

interface ThreadViewProps {
  messages: ThreadMessage[];
  currentUserEmail: string;
}

function getInitialColor(name: string): string {
  const colors = [
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function MessageBubble({
  message,
  isFromCurrentUser,
  isCollapsed: initialCollapsed,
  isLast,
}: {
  message: ThreadMessage;
  isFromCurrentUser: boolean;
  isCollapsed: boolean;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const senderName =
    message.sender?.displayName || message.fromName || message.fromAddress;
  const avatarColor = getInitialColor(message.fromAddress);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group relative"
    >
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-5 top-12 bottom-0 w-px bg-border" />
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className={cn(
            "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            avatarColor
          )}
        >
          {senderName.charAt(0).toUpperCase()}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pb-6">
          {/* Header — always visible */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-start justify-between gap-2 text-left"
          >
            <div className="min-w-0">
              <span className="text-sm font-semibold">
                {isFromCurrentUser ? "You" : senderName}
              </span>
              {collapsed && message.snippet && (
                <span className="ml-2 truncate text-sm text-muted-foreground">
                  — {message.snippet}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                {formatDate(new Date(message.sentAt || message.receivedAt))}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                  !collapsed && "rotate-180"
                )}
              />
            </div>
          </button>

          {/* Expanded content */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                {/* Recipients */}
                <div className="mt-1 text-xs text-muted-foreground">
                  to {message.toAddresses.join(", ")}
                  {message.ccAddresses.length > 0 && (
                    <span>, cc: {message.ccAddresses.join(", ")}</span>
                  )}
                </div>

                {/* Attachments */}
                {message.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {message.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs"
                      >
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                        <span className="max-w-[200px] truncate">
                          {att.filename}
                        </span>
                        <span className="text-muted-foreground">
                          {att.size < 1024
                            ? `${att.size}B`
                            : `${Math.round(att.size / 1024)}KB`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Body */}
                <div className="mt-4">
                  {message.htmlBody ? (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-headings:mb-2 prose-headings:mt-4"
                      dangerouslySetInnerHTML={{ __html: message.htmlBody }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                      {message.textBody || "No content"}
                    </pre>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export function ThreadView({ messages, currentUserEmail }: ThreadViewProps) {
  return (
    <div className="space-y-0">
      {messages.map((message, i) => (
        <MessageBubble
          key={message.id}
          message={message}
          isFromCurrentUser={message.fromAddress === currentUserEmail}
          isCollapsed={i < messages.length - 1}
          isLast={i === messages.length - 1}
        />
      ))}
    </div>
  );
}
