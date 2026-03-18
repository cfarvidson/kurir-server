"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Archive, ChevronDown, MoreHorizontal, Paperclip, Printer } from "lucide-react";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";
import { EmailBodyFrame } from "@/components/mail/email-body-frame";

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
  isArchived?: boolean;
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

function buildEmailHtml(message: ThreadMessage) {
  const senderName =
    message.sender?.displayName || message.fromName || message.fromAddress;
  const date = new Date(
    message.sentAt || message.receivedAt,
  ).toLocaleString();
  const body = message.htmlBody || `<pre style="font-family:sans-serif;white-space:pre-wrap">${message.textBody || ""}</pre>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${message.subject || "(no subject)"}</title>
<style>
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  @media print { body { padding: 0; } }
</style></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:16px;color:#1a1a1a;font-size:14px">
<div style="margin-bottom:20px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
  <div style="font-size:15px;font-weight:600;margin:0 0 8px;color:#111827">${message.subject || "(no subject)"}</div>
  <div style="font-size:11px;color:#6b7280;line-height:1.7">
    <strong style="color:#374151">From:</strong> ${senderName} &lt;${message.fromAddress}&gt;<br>
    <strong style="color:#374151">To:</strong> ${message.toAddresses.join(", ")}${message.ccAddresses.length > 0 ? `<br><strong style="color:#374151">Cc:</strong> ${message.ccAddresses.join(", ")}` : ""}<br>
    <strong style="color:#374151">Date:</strong> ${date}
  </div>
</div>
<div style="overflow:hidden">${body}</div>
</body></html>`;
}

function printEmail(message: ThreadMessage) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(buildEmailHtml(message));
  win.document.close();
  win.addEventListener("load", () => win.print());
}

function MessageBubble({
  message,
  isFromCurrentUser,
  isCollapsed: initialCollapsed,
  isFirst,
  isLast,
}: {
  message: ThreadMessage;
  isFromCurrentUser: boolean;
  isCollapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [quotesCollapsed, setQuotesCollapsed] = useState(true);

  const hasHtmlQuotes =
    /<blockquote|class="gmail_quote"|class="moz-cite-prefix"/.test(
      message.htmlBody ?? ""
    );
  const { body: plainBody, quoted: plainQuoted } = splitPlainTextQuotes(
    message.textBody ?? ""
  );
  const hasQuotes = message.htmlBody ? hasHtmlQuotes : !!plainQuoted;

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
      {/* Connector line — desktop only */}
      {!isLast && (
        <div className="absolute left-5 top-12 bottom-0 hidden w-px bg-border/40 md:block" />
      )}

      {/* Mobile divider between messages */}
      {!isFirst && (
        <div className="mb-2 border-t border-border/30 md:hidden" />
      )}

      <div className="flex gap-0 md:gap-3">
        {/* Avatar — desktop only */}
        <div
          className={cn(
            "relative z-10 hidden shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ring-background md:flex md:h-10 md:w-10 md:text-sm",
            avatarColor
          )}
        >
          {senderName.charAt(0).toUpperCase()}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pb-4 md:pb-8">
          {/* Header — always visible */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0">
              <span className="text-[13px] font-semibold leading-none">
                {isFromCurrentUser ? "You" : senderName}
              </span>
              {message.isArchived && (
                <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Archive className="h-2.5 w-2.5" />
                  archived
                </span>
              )}
              {collapsed && message.snippet && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  — {message.snippet}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <time className="text-[11px] tabular-nums text-muted-foreground/70" suppressHydrationWarning>
                {formatDate(new Date(message.sentAt || message.receivedAt))}
              </time>
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
                <div className="mt-1 rounded-lg border border-border/50 bg-card px-3 py-3 shadow-sm md:px-4 md:py-4">
                  {/* Recipients + actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      to {message.toAddresses.join(", ")}
                      {message.ccAddresses.length > 0 && (
                        <span>, cc: {message.ccAddresses.join(", ")}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          printEmail(message);
                        }}
                        className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                        title="Print this email"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Attachments */}
                  {message.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={`/api/attachments/${att.id}`}
                          download={att.filename}
                          className="inline-flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                        >
                          <Paperclip className="h-3 w-3 text-primary/60" />
                          <span className="max-w-[200px] truncate font-medium">
                            {att.filename}
                          </span>
                          <span className="text-muted-foreground/60">
                            {att.size < 1024
                              ? `${att.size}B`
                              : `${Math.round(att.size / 1024)}KB`}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Body */}
                  <div className="mt-4">
                    {message.htmlBody ? (
                      <EmailBodyFrame
                        html={message.htmlBody}
                        collapseQuotes={quotesCollapsed && hasHtmlQuotes}
                      />
                    ) : (
                      <div>
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                          {plainBody || "No content"}
                        </pre>
                        {plainQuoted && !quotesCollapsed && (
                          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                            {plainQuoted}
                          </pre>
                        )}
                      </div>
                    )}
                    {hasQuotes && (
                      <button
                        onClick={() => setQuotesCollapsed(!quotesCollapsed)}
                        aria-label={
                          quotesCollapsed
                            ? "Show quoted text"
                            : "Hide quoted text"
                        }
                        aria-expanded={!quotesCollapsed}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                        {quotesCollapsed ? "Show quoted text" : "Hide"}
                      </button>
                    )}
                  </div>
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
          isFirst={i === 0}
          isLast={i === messages.length - 1}
        />
      ))}
    </div>
  );
}
