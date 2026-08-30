"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { formatDistanceToNow, formatSnoozeUntil } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArchiveRestore,
  AlarmClock,
  Bell,
  Clock,
  Check,
  Loader2,
  Mail,
  Paperclip,
} from "lucide-react";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import { snoozeConversation } from "@/actions/snooze";
import { setFollowUp } from "@/actions/follow-up";
import { toggleReadStatus } from "@/actions/read-status";
import { showUndoToast } from "@/components/mail/undo-toast";
import { SnoozePicker } from "@/components/mail/snooze-picker";
import { FollowUpPicker } from "@/components/mail/follow-up-picker";
import { SwipeableRow } from "@/components/mail/swipeable-row";
import { threadKeyOf } from "@/lib/mail/thread-key";
import { usePendingArchiveFilter } from "@/lib/mail/optimistic-archive";
import {
  primaryLine,
  swipeActions,
  threadCountLabel,
  type MailListId,
} from "@/lib/mail/list-contract";
import { toast } from "sonner";

export interface MessageItem {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses?: string[];
  ccAddresses?: string[];
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadId?: string | null;
  threadCount?: number;
  snoozedUntil?: Date | null;
  followUpAt?: Date | null;
  isFollowUp?: boolean;
  listLabel?: string | null;
  sender?: {
    id?: string;
    displayName: string | null;
    email: string;
    unthread?: boolean;
  } | null;
}

interface MessageListProps {
  messages: MessageItem[];
  basePath?: string;
  list?: MailListId;
  showArchiveAction?: boolean;
  showUnarchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSnoozedUntil?: boolean;
  showFollowUpAction?: boolean;
}

export function MessageList({
  messages,
  basePath = "/imbox",
  list = "imbox",
  showArchiveAction = false,
  showUnarchiveAction = false,
  showSnoozeAction = false,
  showSnoozedUntil = false,
  showFollowUpAction = false,
}: MessageListProps) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // Suppress rows for threads optimistically archived from the detail view
  // (cold-cache / deep-link safety; mirrors InfiniteMessageList).
  const isPendingArchive = usePendingArchiveFilter();

  const handleArchived = useCallback((messageId?: string) => {
    if (messageId) {
      setHiddenIds((prev) => new Set(prev).add(messageId));
    }
  }, []);

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !hiddenIds.has(m.id) && !isPendingArchive(threadKeyOf(m), m.threadId),
      ),
    [messages, hiddenIds, isPendingArchive],
  );

  return (
    <div>
      <AnimatePresence mode="popLayout">
        {visibleMessages.map((message) => (
          <motion.div
            key={message.id}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <MessageRow
              message={message}
              basePath={basePath}
              list={list}
              showArchiveAction={showArchiveAction}
              showUnarchiveAction={showUnarchiveAction}
              showSnoozeAction={showSnoozeAction}
              showSnoozedUntil={showSnoozedUntil}
              showFollowUpAction={showFollowUpAction}
              onArchived={handleArchived}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function MessageRow({
  message,
  basePath,
  list = "imbox",
  showArchiveAction,
  showUnarchiveAction,
  showSnoozeAction,
  showSnoozedUntil,
  showFollowUpAction,
  onArchived,
  onOpen,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  isFocused,
}: {
  message: MessageItem;
  basePath: string;
  list?: MailListId;
  showArchiveAction: boolean;
  showUnarchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSnoozedUntil?: boolean;
  showFollowUpAction?: boolean;
  onArchived?: (messageId?: string) => void;
  /** Fires when the row is actually being opened (navigation, not selection). */
  onOpen?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isFocused?: boolean;
}) {
  const [actionPending, setActionPending] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const isDragging = useRef(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q");
  const href = q
    ? `${basePath}/${message.id}?q=${encodeURIComponent(q)}`
    : `${basePath}/${message.id}`;
  const countLabel = threadCountLabel(message.threadCount);

  // Listen for keyboard-triggered snooze
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.messageId === message.id) {
        setSnoozeOpen(true);
      }
    };
    window.addEventListener("keyboard-snooze", handler);
    return () => window.removeEventListener("keyboard-snooze", handler);
  }, [message.id]);

  // Listen for keyboard-triggered follow-up
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.messageId === message.id) {
        setFollowUpOpen(true);
      }
    };
    window.addEventListener("keyboard-follow-up", handler);
    return () => window.removeEventListener("keyboard-follow-up", handler);
  }, [message.id]);

  const doArchive = () => {
    onArchived?.(message.id);
    setActionPending(true);

    const subject =
      message.subject ||
      message.sender?.displayName ||
      message.fromName ||
      "email";
    showUndoToast({
      id: `archive-${message.id}`,
      label: "Archived",
      description: subject,
      onUndo: () => {
        unarchiveConversation(message.id).then(() => router.refresh());
      },
    });

    // Fire-and-forget: don't block UI with startTransition
    archiveConversation(message.id, basePath).then(() => router.refresh());
  };

  const doUnarchive = () => {
    onArchived?.(message.id);
    setActionPending(true);
    unarchiveConversation(message.id).then(() => router.refresh());
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    doArchive();
  };

  const handleUnarchive = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    doUnarchive();
  };

  const handleSnooze = (until: Date) => {
    onArchived?.(message.id);
    setActionPending(true);
    snoozeConversation(message.id, until).then(() => router.refresh());
  };

  const handleFollowUp = (until: Date) => {
    // On the follow-up page, rescheduling removes the message from the list
    if (basePath === "/follow-up") {
      onArchived?.(message.id);
    }
    const diffDays = Math.ceil(
      (until.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    toast.success(
      `Following up ${diffDays === 1 ? "tomorrow" : `in ${diffDays} days`}`,
    );
    setActionPending(true);
    setFollowUp(message.id, until).then(() => router.refresh());
  };

  // Leading = read (positive x); trailing = archive/unarchive. Snooze is
  // hover + keyboard `s` + select bar only — SwipeableRow has one left callback.
  const actions = swipeActions(list);
  const handleSwipeRead = () => {
    toggleReadStatus(message.id).then(() => router.refresh());
  };
  const swipeLeftAction =
    actions.trailing === "archive"
      ? doArchive
      : actions.trailing === "unarchive"
        ? doUnarchive
        : undefined;
  const swipeLeftIcon =
    actions.trailing === "unarchive" ? (
      <ArchiveRestore className="h-5 w-5" />
    ) : actions.trailing === "archive" ? (
      <Archive className="h-5 w-5" />
    ) : undefined;
  const swipeLeftColor =
    actions.trailing === "archive"
      ? "bg-green-600"
      : actions.trailing === "unarchive"
        ? "bg-primary"
        : undefined;

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging.current) {
      e.preventDefault();
      return;
    }
    // Shift-click enters/toggles selection
    if (e.shiftKey && onToggleSelect) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    // In selection mode, click toggles selection instead of navigating
    if (isSelectionMode && onToggleSelect) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    onOpen?.();
  };

  const rowContent = (
    <>
      {/* Checkbox (selection mode only) */}
      {isSelectionMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select conversation from ${message.sender?.displayName || message.fromName || message.fromAddress}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-all",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30 bg-background hover:border-muted-foreground/60",
          )}
        >
          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      )}

      {/* Unread tick — terracotta left rule in the row gutter, no layout shift */}
      {!isSelectionMode && !message.isRead && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-[60%] w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {message.listLabel && (
          <p className="eyebrow text-muted-foreground">{message.listLabel}</p>
        )}
        <div className="flex items-center gap-1.5 md:gap-2">
          <span
            className={cn(
              "truncate text-sm",
              !message.isRead
                ? "font-semibold text-foreground"
                : "font-medium text-foreground",
            )}
          >
            {primaryLine({
              list,
              displayName: message.sender?.displayName,
              fromName: message.fromName,
              fromAddress: message.fromAddress,
              toAddresses: message.toAddresses,
              cc: message.ccAddresses?.join(", ") || null,
            })}
          </span>
          {countLabel && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {countLabel}
            </span>
          )}
          {message.hasAttachments && (
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDistanceToNow(new Date(message.receivedAt))}
          </span>
        </div>
        <div
          className={cn(
            "truncate",
            !message.isRead
              ? "text-lead font-medium text-foreground"
              : "text-[0.9375rem] text-muted-foreground",
          )}
        >
          {message.subject || "(no subject)"}
        </div>
        {message.snippet && (
          <div className="mt-0.5 line-clamp-2 text-[0.8125rem] text-muted-foreground">
            {message.snippet}
          </div>
        )}
        {message.followUpAt && (
          <div
            className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            <Bell className="h-3 w-3" />
            {formatFollowUpAt(new Date(message.followUpAt))}
          </div>
        )}
        {showSnoozedUntil && message.snoozedUntil && (
          <div
            className="mt-0.5 flex items-center gap-1 text-xs text-primary/70"
            suppressHydrationWarning
          >
            <AlarmClock className="h-3 w-3" />
            {formatSnoozeUntil(new Date(message.snoozedUntil))}
          </div>
        )}
      </div>

      {/* Hover action buttons — hidden on mobile (swipe replaces them),
          hover-reveal on desktop. Words first: icon-only + kbd was
          unreadable, same as the Mac row chip. */}
      {(showArchiveAction ||
        showUnarchiveAction ||
        showSnoozeAction ||
        showFollowUpAction) &&
        !isSelectionMode && (
          <div
            className="absolute top-3 right-3 z-10 hidden items-center rounded-lg border border-border bg-background md:flex md:right-5 md:pointer-events-none md:opacity-0 md:transition-opacity md:group-hover:pointer-events-auto md:group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {showFollowUpAction && (
              <FollowUpPicker
                onFollowUp={handleFollowUp}
                isPending={actionPending}
                side="bottom"
                align="end"
                trigger={
                  <button className={rowActionBtnClass} title="Follow up">
                    <Bell
                      className={cn(
                        "h-3.5 w-3.5",
                        message.followUpAt && "text-amber-500",
                      )}
                    />
                    Follow up
                    <RowActionKbd>F</RowActionKbd>
                  </button>
                }
              />
            )}
            {showSnoozeAction && (
              <SnoozePicker
                onSnooze={handleSnooze}
                isPending={actionPending}
                side="bottom"
                align="end"
                trigger={
                  <button className={rowActionBtnClass} title="Snooze">
                    <Clock className="h-3.5 w-3.5" />
                    Snooze
                    <RowActionKbd>S</RowActionKbd>
                  </button>
                }
              />
            )}
            {showArchiveAction && (
              <button
                onClick={handleArchive}
                className={rowActionBtnClass}
                title="Archive"
              >
                {actionPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                    <RowActionKbd>E</RowActionKbd>
                  </>
                )}
              </button>
            )}
            {showUnarchiveAction && (
              <button
                onClick={handleUnarchive}
                className={rowActionBtnClass}
                title="Unarchive"
              >
                {actionPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Unarchive
                    <RowActionKbd>E</RowActionKbd>
                  </>
                )}
              </button>
            )}
          </div>
        )}

      {/* Controlled SnoozePicker for keyboard `s` — lazy-mounted */}
      {showSnoozeAction && !isSelectionMode && snoozeOpen && (
        <SnoozePicker
          onSnooze={handleSnooze}
          isPending={actionPending}
          side="bottom"
          align="center"
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          trigger={<span className="sr-only">Snooze</span>}
        />
      )}

      {/* Controlled FollowUpPicker for keyboard trigger — lazy-mounted */}
      {showFollowUpAction && !isSelectionMode && followUpOpen && (
        <FollowUpPicker
          onFollowUp={handleFollowUp}
          isPending={actionPending}
          side="bottom"
          align="center"
          open={followUpOpen}
          onOpenChange={setFollowUpOpen}
          trigger={<span className="sr-only">Follow up</span>}
        />
      )}
    </>
  );

  const focusRing = isFocused && "ring-2 ring-inset ring-primary/40";

  // In selection mode, render as div without swipe (swipe disabled)
  if (isSelectionMode) {
    return (
      <div
        onClick={handleClick}
        data-keyboard-focused={isFocused || undefined}
        className={cn(
          "group relative flex cursor-pointer items-start gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
          isSelected && "bg-primary/10",
          actionPending && "opacity-50 pointer-events-none",
          focusRing,
        )}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <SwipeableRow
      onSwipeRight={
        actions.leading === "read" ? handleSwipeRead : undefined
      }
      onSwipeLeft={swipeLeftAction}
      swipeRightIcon={<Mail className="h-5 w-5" />}
      swipeRightColor="bg-blue-500"
      swipeLeftIcon={swipeLeftIcon}
      swipeLeftColor={swipeLeftColor}
      disabled={actionPending}
      onDragStateChange={(dragging) => {
        isDragging.current = dragging;
      }}
    >
      <Link
        href={href}
        onClick={handleClick}
        data-keyboard-focused={isFocused || undefined}
        className={cn(
          "group relative flex items-start gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
          actionPending && "opacity-50 pointer-events-none",
          focusRing,
        )}
      >
        {rowContent}
      </Link>
    </SwipeableRow>
  );
}

function formatFollowUpAt(date: Date): string {
  return date.getTime() > Date.now()
    ? formatSnoozeUntil(date)
    : formatDistanceToNow(date);
}

const rowActionBtnClass =
  "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground";

function RowActionKbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}
