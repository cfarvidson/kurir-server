"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  Archive,
  ChevronDown,
  Forward,
  MoreHorizontal,
  Printer,
  Reply,
  ReplyAll,
  Split,
} from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";
import { MeetingCard } from "@/components/calendar/meeting-card";
import { EmailBodyFrame } from "@/components/mail/email-body-frame";
import { AttachmentList } from "@/components/mail/attachment-list";
import { BlockedImagesBanner } from "@/components/mail/blocked-images-banner";
import { RecipientList } from "@/components/mail/recipient-list";
import {
  resolveRecipientName,
  type RecipientNameMap,
} from "@/lib/mail/recipient-names";
import { cardLabel } from "@/lib/mail/thread-card";
import { sanitizeEmailHtml } from "@/lib/mail/sanitize-html";
import { BlockedTrackersIndicator } from "@/components/mail/blocked-trackers-indicator";
import {
  imagePolicyToSanitizeFlags,
  resolveEffectiveMessagePolicy,
  type RemoteImagePolicy,
} from "@/lib/mail/image-policy";
import type { MeetingCardMeeting } from "@/lib/calendar/meeting-card";

interface ThreadMessage {
  id: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses?: string[];
  receivedAt: Date;
  sentAt: Date | null;
  textBody: string | null;
  htmlBody: string | null;
  isRead: boolean;
  isAnswered: boolean;
  isArchived?: boolean;
  snippet: string | null;
  sender?: {
    id?: string;
    displayName: string | null;
    email: string;
    allowRemoteImages?: boolean;
  } | null;
  attachments: {
    id: string;
    filename: string;
    size: number;
    contentId: string | null;
    contentType: string;
  }[];
  meeting?: MeetingCardMeeting | null;
}

/** A thread split from this one (plan 055), rendered under the broadcast card. */
export interface ThreadBranchLink {
  threadId: string;
  href: string;
  senderName: string;
  count: number;
  rootInReplyTo: string | null;
}

export type ReplyMode = "reply" | "replyAll";

interface ThreadViewProps {
  messages: ThreadMessage[];
  currentUserEmail: string;
  userEmails?: Set<string>;
  /** Card the composer currently targets; its Reply button reads as active. */
  replyTargetId?: string | null;
  /** Cards the user has already replied to (see answeredMessageIds). */
  answeredIds?: Set<string>;
  /** Cards with a saved reply draft. */
  draftIds?: Set<string>;
  /** Cards whose reply-all would add recipients beyond the primary one. */
  replyAllIds?: Set<string>;
  onReply?: (messageId: string, mode: ReplyMode) => void;
  branches?: ThreadBranchLink[];
  /** User's global remote-image policy (block all / block trackers / allow all). */
  remoteImagePolicy?: RemoteImagePolicy;
  /** Lowercased address → contact name, for recipient display. */
  recipientNames?: RecipientNameMap;
  hasWritableCalendar?: boolean;
  timezone?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SanitizeImageFlags {
  blockRemoteImages: boolean;
  blockTrackers: boolean;
}

function buildEmailHtml(message: ThreadMessage, imageFlags: SanitizeImageFlags) {
  const senderName = escapeHtml(
    message.sender?.displayName || message.fromName || message.fromAddress,
  );
  const subject = escapeHtml(message.subject || "(no subject)");
  const fromAddress = escapeHtml(message.fromAddress);
  const toAddresses = escapeHtml(message.toAddresses.join(", "));
  const ccAddresses = escapeHtml(message.ccAddresses.join(", "));
  const date = new Date(message.sentAt || message.receivedAt).toLocaleString();
  const body = message.htmlBody
    ? sanitizeEmailHtml(message.htmlBody, {
        blockRemoteImages: imageFlags.blockRemoteImages,
        blockTrackers: imageFlags.blockTrackers,
      })
    : `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(message.textBody || "")}</pre>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title>
<style>
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  @media print { body { padding: 0; } }
</style></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:16px;color:#1a1a1a;font-size:14px">
<div style="margin-bottom:20px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
  <div style="font-size:15px;font-weight:600;margin:0 0 8px;color:#111827">${subject}</div>
  <div style="font-size:11px;color:#6b7280;line-height:1.7">
    <strong style="color:#374151">From:</strong> ${senderName} &lt;${fromAddress}&gt;<br>
    <strong style="color:#374151">To:</strong> ${toAddresses}${message.ccAddresses.length > 0 ? `<br><strong style="color:#374151">Cc:</strong> ${ccAddresses}` : ""}<br>
    <strong style="color:#374151">Date:</strong> ${date}
  </div>
</div>
<div style="overflow:hidden">${body}</div>
</body></html>`;
}

function printEmail(message: ThreadMessage, imageFlags: SanitizeImageFlags) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(buildEmailHtml(message, imageFlags));
  win.document.close();
  win.addEventListener("load", () => win.print());
}

function BranchList({ branches }: { branches: ThreadBranchLink[] }) {
  const n = branches.length;
  return (
    <div
      data-thread-branches
      className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 text-xs text-muted-foreground"
    >
      <Split className="h-3 w-3 shrink-0" />
      <span>
        {n} {n === 1 ? "reply" : "replies"} opened as separate{" "}
        {n === 1 ? "thread" : "threads"}
      </span>
      {branches.map((branch) => (
        <span key={branch.threadId} className="inline-flex items-center gap-1.5">
          <span aria-hidden>·</span>
          <Link
            href={branch.href}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {branch.senderName}
            {branch.count > 1 && (
              <span className="ml-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                ·{branch.count}
              </span>
            )}
          </Link>
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  isFromCurrentUser,
  label,
  isCollapsed: initialCollapsed,
  isFirst,
  isReplyTarget = false,
  isAnswered = false,
  hasDraft = false,
  canReplyAll = false,
  onReply,
  branches = [],
  remoteImagePolicy = "BLOCK_ALL",
  recipientNames = {},
  hasWritableCalendar = false,
  timezone = "UTC",
}: {
  message: ThreadMessage;
  isFromCurrentUser: boolean;
  label: string;
  isCollapsed: boolean;
  isFirst: boolean;
  isReplyTarget?: boolean;
  isAnswered?: boolean;
  hasDraft?: boolean;
  canReplyAll?: boolean;
  onReply?: (messageId: string, mode: ReplyMode) => void;
  branches?: ThreadBranchLink[];
  remoteImagePolicy?: RemoteImagePolicy;
  recipientNames?: RecipientNameMap;
  hasWritableCalendar?: boolean;
  timezone?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [quotesCollapsed, setQuotesCollapsed] = useState(true);
  const [imagesRevealed, setImagesRevealed] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [blockedTrackers, setBlockedTrackers] = useState(0);

  // The effective per-message policy (see resolveEffectiveMessagePolicy for the
  // override rules). Drives the sanitizer flags for this message body.
  const effectivePolicy = resolveEffectiveMessagePolicy({
    globalPolicy: remoteImagePolicy,
    isFromCurrentUser,
    senderAllowsRemoteImages: message.sender?.allowRemoteImages ?? false,
    imagesRevealed,
  });
  const sanitizeFlags = imagePolicyToSanitizeFlags(effectivePolicy);
  // True only in full block-all mode — drives the "Load images" banner + print.
  const shouldBlockImages = sanitizeFlags.blockRemoteImages;

  const hasHtmlQuotes =
    /<blockquote|class="gmail_quote"|class="moz-cite-prefix"/.test(
      message.htmlBody ?? "",
    );
  const { body: plainBody, quoted: plainQuoted } = splitPlainTextQuotes(
    message.textBody ?? "",
  );
  const hasQuotes = message.htmlBody ? hasHtmlQuotes : !!plainQuoted;

  const actionClass =
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group relative"
    >
      {/* Mobile divider between messages */}
      {!isFirst && <div className="mb-2 border-t border-border/30 md:hidden" />}

      <div className="flex">
        {/* Content */}
        <div className="min-w-0 flex-1 pb-4 md:pb-8">
          {/* Header — always visible */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0">
              <span className="text-sm font-semibold leading-none tracking-tight">
                {label}
              </span>
              {isAnswered && (
                <span
                  data-card-badge="replied"
                  className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
                >
                  <Reply className="h-2.5 w-2.5" />
                  replied
                </span>
              )}
              {hasDraft && (
                <span
                  data-card-badge="draft"
                  className="ml-1.5 inline-flex items-center rounded-sm bg-primary/10 px-1 text-[10px] font-medium text-primary"
                >
                  draft
                </span>
              )}
              {message.isArchived && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
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
              <time
                className="text-[11px] tabular-nums text-muted-foreground/70"
                suppressHydrationWarning
              >
                {formatDate(new Date(message.sentAt || message.receivedAt))}
              </time>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                  !collapsed && "rotate-180",
                )}
              />
            </div>
          </button>

          {/* Expanded content */}
          {!collapsed && (
            <div style={{ overflowAnchor: "none" }}>
              <div className="mt-1 rounded-lg border border-border/60 bg-card px-3 py-3 md:px-4 md:py-4">
                {/* Recipients + actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    <RecipientList
                      label="to"
                      addresses={message.toAddresses}
                      nameMap={recipientNames}
                    />
                    {message.ccAddresses.length > 0 && (
                      <>
                        ,{" "}
                        <RecipientList
                          label="cc:"
                          addresses={message.ccAddresses}
                          nameMap={recipientNames}
                        />
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        printEmail(message, sanitizeFlags);
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
                  <AttachmentList attachments={message.attachments} />
                )}

                {message.meeting && (
                  <MeetingCard
                    messageId={message.id}
                    meeting={message.meeting}
                    hasWritableCalendar={hasWritableCalendar}
                    timezone={timezone}
                  />
                )}

                {/* Body */}
                <div className="mt-4">
                  {message.htmlBody ? (
                    <>
                      {shouldBlockImages && blockedCount > 0 && (
                        <BlockedImagesBanner
                          count={blockedCount}
                          senderId={message.sender?.id}
                          senderLabel={
                            message.sender?.displayName ||
                            message.sender?.email
                          }
                          onLoadImages={() => setImagesRevealed(true)}
                        />
                      )}
                      {sanitizeFlags.blockTrackers && blockedTrackers > 0 && (
                        <BlockedTrackersIndicator count={blockedTrackers} />
                      )}
                      <EmailBodyFrame
                        html={message.htmlBody}
                        collapseQuotes={quotesCollapsed && hasHtmlQuotes}
                        attachments={message.attachments}
                        blockRemoteImages={sanitizeFlags.blockRemoteImages}
                        blockTrackers={sanitizeFlags.blockTrackers}
                        onBlockedCount={setBlockedCount}
                        onTrackerCount={setBlockedTrackers}
                      />
                    </>
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
                      data-quote-toggle
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

                {/* Card actions: reply to exactly this message (plan 055) */}
                <div
                  data-card-actions
                  className="mt-4 flex flex-wrap items-center gap-1 border-t border-border/40 pt-3"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReply?.(message.id, "reply");
                    }}
                    aria-pressed={isReplyTarget}
                    className={cn(
                      actionClass,
                      isReplyTarget && "bg-primary/10 text-foreground",
                    )}
                    title={`Reply to ${label}`}
                  >
                    <Reply className="h-3.5 w-3.5" />
                    Reply
                  </button>
                  {canReplyAll && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReply?.(message.id, "replyAll");
                      }}
                      className={actionClass}
                      title="Reply all"
                    >
                      <ReplyAll className="h-3.5 w-3.5" />
                      Reply all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(
                        `/compose?forward=${message.id}&from=${encodeURIComponent(pathname)}`,
                      );
                    }}
                    className={actionClass}
                    title="Forward this email"
                  >
                    <Forward className="h-3.5 w-3.5" />
                    Forward
                  </button>
                </div>
              </div>
            </div>
          )}

          {branches.length > 0 && <BranchList branches={branches} />}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Which card each branch hangs under: the message it replied to, else the
 * last own card (the broadcast the split came from), else the first card.
 */
export function branchesByCard(
  messages: ThreadMessage[],
  branches: ThreadBranchLink[],
  isOwn: (address: string) => boolean,
): Map<string, ThreadBranchLink[]> {
  const byCard = new Map<string, ThreadBranchLink[]>();
  if (branches.length === 0 || messages.length === 0) return byCard;
  const lastOwn = [...messages].reverse().find((m) => isOwn(m.fromAddress));
  const fallback = (lastOwn ?? messages[0]).id;
  for (const branch of branches) {
    const card =
      messages.find(
        (m) => branch.rootInReplyTo && m.messageId === branch.rootInReplyTo,
      )?.id ?? fallback;
    byCard.set(card, [...(byCard.get(card) ?? []), branch]);
  }
  return byCard;
}

export function ThreadView({
  messages,
  currentUserEmail,
  userEmails,
  replyTargetId = null,
  answeredIds,
  draftIds,
  replyAllIds,
  onReply,
  branches = [],
  remoteImagePolicy = "BLOCK_ALL",
  recipientNames = {},
  hasWritableCalendar = false,
  timezone = "UTC",
}: ThreadViewProps) {
  const emailSet = userEmails ?? new Set([currentUserEmail.toLowerCase()]);
  const isOwn = (address: string) => emailSet.has(address.trim().toLowerCase());
  const nameFor = (address: string) =>
    resolveRecipientName(address, recipientNames);
  const branchCards = branchesByCard(messages, branches, isOwn);
  return (
    <div className="space-y-0">
      {messages.map((message, i) => (
        <MessageBubble
          key={message.id}
          message={message}
          isFromCurrentUser={isOwn(message.fromAddress)}
          label={cardLabel(message, isOwn, nameFor)}
          isCollapsed={i < messages.length - 1}
          isFirst={i === 0}
          isReplyTarget={message.id === replyTargetId}
          isAnswered={answeredIds?.has(message.id) ?? false}
          hasDraft={draftIds?.has(message.id) ?? false}
          canReplyAll={replyAllIds?.has(message.id) ?? false}
          onReply={onReply}
          branches={branchCards.get(message.id) ?? []}
          remoteImagePolicy={remoteImagePolicy}
          recipientNames={recipientNames}
          hasWritableCalendar={hasWritableCalendar}
          timezone={timezone}
        />
      ))}
    </div>
  );
}
