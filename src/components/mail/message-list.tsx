"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Archive, Clock, Check, Loader2, Paperclip, MessageSquare } from "lucide-react";
import { archiveConversation } from "@/actions/archive";
import { snoozeConversation } from "@/actions/snooze";
import { SnoozePicker } from "@/components/mail/snooze-picker";

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
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface MessageListProps {
  messages: MessageItem[];
  basePath?: string;
  showArchiveAction?: boolean;
  showSnoozeAction?: boolean;
}

export function MessageList({
  messages,
  basePath = "/imbox",
  showArchiveAction = false,
  showSnoozeAction = false,
}: MessageListProps) {
  return (
    <div>
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          basePath={basePath}
          showArchiveAction={showArchiveAction}
          showSnoozeAction={showSnoozeAction}
        />
      ))}
    </div>
  );
}

export function MessageRow({
  message,
  basePath,
  showArchiveAction,
  showSnoozeAction,
  onArchived,
  isSelectionMode,
  isSelected,
  onToggleSelect,
}: {
  message: MessageItem;
  basePath: string;
  showArchiveAction: boolean;
  showSnoozeAction?: boolean;
  onArchived?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const q = searchParams.get("q");
  const href = q
    ? `${basePath}/${message.id}?q=${encodeURIComponent(q)}`
    : `${basePath}/${message.id}`;
  const hasThread = (message.threadCount ?? 0) > 1;

  const handleArchive = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await archiveConversation(message.id);
      onArchived?.();
    });
  };

  const handleSnooze = (until: Date) => {
    startTransition(async () => {
      await snoozeConversation(message.id, until);
      onArchived?.();
    });
  };

  const handleClick = (e: React.MouseEvent) => {
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
              : "border-muted-foreground/30 bg-background hover:border-muted-foreground/60"
          )}
        >
          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      )}

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

      {/* Hover action buttons (hidden in selection mode) */}
      {(showArchiveAction || showSnoozeAction) && !isSelectionMode && (
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 md:right-5">
          {showSnoozeAction && (
            <SnoozePicker
              onSnooze={handleSnooze}
              isPending={isPending}
              side="bottom"
              align="end"
              trigger={
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Snooze"
                >
                  <Clock className="h-4 w-4" />
                </button>
              }
            />
          )}
          {showArchiveAction && (
            <button
              onClick={handleArchive}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Archive"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      )}
    </>
  );

  // In selection mode, render as div instead of Link to prevent navigation
  if (isSelectionMode) {
    return (
      <div
        onClick={handleClick}
        className={cn(
          "group relative flex cursor-pointer items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
          !message.isRead && "bg-primary/5",
          isSelected && "bg-primary/10",
          isPending && "opacity-50 pointer-events-none"
        )}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={cn(
        "group relative flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 md:gap-4 md:px-6 md:py-4",
        !message.isRead && "bg-primary/5",
        isPending && "opacity-50 pointer-events-none"
      )}
    >
      {rowContent}
    </Link>
  );
}
