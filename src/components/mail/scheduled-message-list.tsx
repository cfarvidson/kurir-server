"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Send,
  X,
  Pencil,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelScheduledMessage,
  sendScheduledMessageNow,
} from "@/actions/scheduled-messages";

export interface ScheduledMessageItem {
  id: string;
  to: string;
  subject: string;
  snippet: string;
  scheduledFor: string; // ISO string
  status: "PENDING" | "FAILED";
  error: string | null;
}

interface ScheduledMessageListProps {
  messages: ScheduledMessageItem[];
  timezone: string;
}

export function ScheduledMessageList({
  messages,
  timezone,
}: ScheduledMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-muted p-4">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-medium">No scheduled messages</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages you schedule to send later will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {messages.map((msg) => (
        <ScheduledMessageRow key={msg.id} message={msg} timezone={timezone} />
      ))}
    </div>
  );
}

function ScheduledMessageRow({
  message,
  timezone,
}: {
  message: ScheduledMessageItem;
  timezone: string;
}) {
  const router = useRouter();
  const [isCancelling, startCancelTransition] = useTransition();
  const [isSending, startSendTransition] = useTransition();

  const handleCancel = () => {
    startCancelTransition(async () => {
      try {
        await cancelScheduledMessage(message.id);
        toast.success("Scheduled message cancelled");
        router.refresh();
      } catch {
        toast.error("Failed to cancel message");
      }
    });
  };

  const handleSendNow = () => {
    startSendTransition(async () => {
      try {
        await sendScheduledMessageNow(message.id);
        toast.success("Message sent");
        router.refresh();
      } catch {
        toast.error("Failed to send message");
      }
    });
  };

  const handleEdit = () => {
    router.push(`/compose?editScheduled=${message.id}`);
  };

  const isPending = isCancelling || isSending;
  const scheduledDate = new Date(message.scheduledFor);

  return (
    <div className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/40 md:px-6">
      {/* Status indicator */}
      <div className="mt-1 shrink-0">
        {message.status === "FAILED" ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <Clock className="h-4 w-4 text-blue-500" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Recipient + subject */}
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            To: {message.to}
          </span>
          {message.status === "FAILED" && (
            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              Failed
            </span>
          )}
          {message.status === "PENDING" && (
            <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
              Pending
            </span>
          )}
        </div>

        <div className="truncate text-sm text-foreground/80">
          {message.subject || "(no subject)"}
        </div>

        {/* Snippet */}
        {message.snippet && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {message.snippet}
          </div>
        )}

        {/* Scheduled time */}
        <div
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          <Clock className="h-3 w-3" />
          <span suppressHydrationWarning>
            {formatScheduledTime(scheduledDate, timezone)}
          </span>
          <span className="text-muted-foreground/60" suppressHydrationWarning>
            ({formatAbsoluteTime(scheduledDate, timezone)})
          </span>
        </div>

        {/* Error message for failed */}
        {message.status === "FAILED" && message.error && (
          <div className="mt-1 flex items-center gap-1 text-xs text-destructive/80">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{message.error}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={handleEdit}
          disabled={isPending}
          title="Edit"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          <span className="hidden sm:inline">Edit</span>
        </button>
        <button
          onClick={handleSendNow}
          disabled={isPending}
          title="Send now"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {isSending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Send now</span>
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          title="Cancel"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {isCancelling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Cancel</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Format scheduled time as a relative description.
 * E.g., "Tomorrow at 8:00 AM", "Monday at 2:00 PM", "in 3 hours"
 */
function formatScheduledTime(date: Date, timezone: string): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "sending soon...";

  const diffMins = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMins / 60);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

  if (diffMins < 60) return `in ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  if (diffHours < 2) return `in about ${diffHours} hour`;

  // Compare dates in user's timezone
  const nowInTz = new Date(
    now.toLocaleString("en-US", { timeZone: timezone }),
  );
  const dateInTz = new Date(
    date.toLocaleString("en-US", { timeZone: timezone }),
  );

  const todayStr = nowInTz.toDateString();
  const dateStr = dateInTz.toDateString();

  if (todayStr === dateStr) {
    return `Today at ${timeStr}`;
  }

  const tomorrow = new Date(nowInTz);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === tomorrow.toDateString()) {
    return `Tomorrow at ${timeStr}`;
  }

  const diffDays = Math.floor(diffMs / 1000 / 60 / 60 / 24);
  if (diffDays < 7) {
    const dayName = date.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: timezone,
    });
    return `${dayName} at ${timeStr}`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

/**
 * Format as an absolute date/time string in the user's timezone.
 * E.g., "Mar 19, 2026, 8:00 AM EST"
 */
function formatAbsoluteTime(date: Date, timezone: string): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone,
  });
}
