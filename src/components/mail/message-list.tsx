"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
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
  Paperclip,
  MessageSquare,
} from "lucide-react";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import { snoozeConversation } from "@/actions/snooze";
import { setFollowUp } from "@/actions/follow-up";
import { showUndoToast } from "@/components/mail/undo-toast";
import { SnoozePicker } from "@/components/mail/snooze-picker";
import { FollowUpPicker } from "@/components/mail/follow-up-picker";
import { SwipeableRow } from "@/components/mail/swipeable-row";
import { toast } from "sonner";

export interface MessageItem {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadId?: string | null;
  threadCount?: number;
  snoozedUntil?: Date | null;
  followUpAt?: Date | null;
  isFollowUp?: boolean;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface MessageListProps {
  messages: MessageItem[];
  basePath?: string;
  showArchiveAction?: boolean;
  showUnarchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSnoozedUntil?: boolean;
  showFollowUpAction?: boolean;
}

export function MessageList({
  messages,
  basePath = "/imbox",
  showArchiveAction = false,
  showUnarchiveAction = false,
  showSnoozeAction = false,
  showSnoozedUntil = false,
  showFollowUpAction = false,
}: MessageListProps) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const handleArchived = useCallback((messageId?: string) => {
    if (messageId) {
      setHiddenIds((prev) => new Set(prev).add(messageId));
    }
  }, []);

  const visibleMessages = messages.filter((m) => !hiddenIds.has(m.id));

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
  showArchiveAction,
  showUnarchiveAction,
  showSnoozeAction,
  showSnoozedUntil,
  showFollowUpAction,
  onArchived,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  isFocused,
}: {
  message: MessageItem;
  basePath: string;
  showArchiveAction: boolean;
  showUnarchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSnoozedUntil?: boolean;
  showFollowUpAction?: boolean;
  onArchived?: (messageId?: string) => void;
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
  const hasThread = (message.threadCount ?? 0) > 1;

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

  // Swipe config — derived from action props
  const swipeRightAction = showArchiveAction
    ? doArchive
    : showUnarchiveAction
      ? doUnarchive
      : undefined;
  const swipeRightIcon = showUnarchiveAction ? (
    <ArchiveRestore className="h-5 w-5" />
  ) : undefined;
  const swipeRightColor = showUnarchiveAction ? "bg-blue-500" : undefined;

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
    }
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

      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary md:h-10 md:w-10">
        {(
          message.sender?.displayName ||
          message.fromName ||
          message.fromAddress
        )
          .charAt(0)
          .toUpperCase()}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 md:gap-2">
          <span
            className={cn(
              "truncate text-sm",
              !message.isRead && "font-semibold",
            )}
          >
            {message.sender?.displayName ||
              message.fromName ||
              message.fromAddress}
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
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDistanceToNow(new Date(message.receivedAt))}
          </span>
        </div>
        <div
          className={cn(
            "truncate text-sm",
            !message.isRead ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {message.subject || "(no subject)"}
        </div>
        {message.snippet && (
          <div className="truncate text-sm text-muted-foreground">
            {message.snippet}
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

      {/* Hover action buttons — hidden on mobile (swipe replaces them), hover-reveal on desktop */}
      {(showArchiveAction ||
        showUnarchiveAction ||
        showSnoozeAction ||
        showFollowUpAction) &&
        !isSelectionMode && (
          <div
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 md:flex md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-data-keyboard-focused:opacity-100 md:right-5"
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
                  <button
                    className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Follow up"
                  >
                    <Bell
                      className={cn(
                        "h-4 w-4",
                        message.followUpAt && "text-amber-500",
                      )}
                    />
                    <kbd className="hidden h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[9px] text-muted-foreground/50 lg:inline-flex">
                      F
                    </kbd>
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
                  <button
                    className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Snooze"
                  >
                    <Clock className="h-4 w-4" />
                    <kbd className="hidden h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[9px] text-muted-foreground/50 lg:inline-flex">
                      S
                    </kbd>
                  </button>
                }
              />
            )}
            {showArchiveAction && (
              <button
                onClick={handleArchive}
                className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Archive"
              >
                {actionPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Archive className="h-4 w-4" />
                    <kbd className="hidden h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[9px] text-muted-foreground/50 lg:inline-flex">
                      E
                    </kbd>
                  </>
                )}
              </button>
            )}
            {showUnarchiveAction && (
              <button
                onClick={handleUnarchive}
                className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Unarchive"
              >
                {actionPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArchiveRestore className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}

      {/* Controlled SnoozePicker for swipe-left on mobile — lazy-mounted */}
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
          "group relative flex cursor-pointer items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
          !message.isRead && "bg-primary/5",
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
      onSwipeRight={swipeRightAction}
      onSwipeLeft={showSnoozeAction ? () => setSnoozeOpen(true) : undefined}
      swipeRightIcon={swipeRightIcon}
      swipeRightColor={swipeRightColor}
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
          "group relative flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
          !message.isRead && "bg-primary/5",
          actionPending && "opacity-50 pointer-events-none",
          focusRing,
        )}
      >
        {rowContent}
      </Link>
    </SwipeableRow>
  );
}
