"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Reply,
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { formatDate } from "@/lib/date";
import { clearReplyLater } from "@/actions/reply-later";

export interface ReplyLaterItem {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromAddress: string;
  receivedAt: Date;
  threadCount: number;
}

/**
 * Focus mode for the Reply Later pile: walks pending threads one at a time.
 * "Open & reply" jumps to the full thread (with composer); "Done" clears the
 * flag and advances; the arrows let you skip around without changing anything.
 */
export function ReplyLaterFocus({ items }: { items: ReplyLaterItem[] }) {
  const router = useRouter();
  // Derive the visible queue from props minus locally-cleared ids, so a
  // router.refresh() (or a thread flagged elsewhere) re-syncs on the next
  // render instead of being shadowed by stale local state.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  const queue = items.filter((it) => !clearedIds.has(it.id));

  if (queue.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-emerald-100 p-4 dark:bg-emerald-900/30">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="mt-4 text-lg font-medium">All caught up</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing left to reply to. Nice work.
        </p>
      </div>
    );
  }

  const safeIndex = Math.min(index, queue.length - 1);
  const current = queue[safeIndex];
  const sender = current.fromName || current.fromAddress;

  function handleDone() {
    const id = current.id;
    // Keep the cursor on the item that shifts into this slot; clamp when the
    // last item was removed.
    const remaining = queue.length - 1;
    startTransition(async () => {
      await clearReplyLater(id);
      setClearedIds((prev) => new Set(prev).add(id));
      setIndex(Math.max(0, Math.min(safeIndex, remaining - 1)));
      router.refresh();
    });
  }

  function go(delta: number) {
    setIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:py-10">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {safeIndex + 1} of {queue.length} to reply
        </span>
        <span className="inline-flex items-center gap-1">
          <Reply className="h-3.5 w-3.5" />
          Reply Later
        </span>
      </div>

      {/* Current thread card */}
      <div className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sender}</p>
            <h2 className="mt-1 text-base font-medium leading-snug">
              {current.subject || "(no subject)"}
            </h2>
          </div>
          <time
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDate(new Date(current.receivedAt))}
          </time>
        </div>
        {current.snippet && (
          <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">
            {current.snippet}
          </p>
        )}
        {current.threadCount > 1 && (
          <p className="mt-2 text-xs text-muted-foreground/70">
            {current.threadCount} messages in thread
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/reply-later/${current.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Reply className="h-4 w-4" />
            Open &amp; reply
          </Link>
          <button
            type="button"
            onClick={handleDone}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Done
          </button>
        </div>
      </div>

      {/* Skip navigation */}
      {queue.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={safeIndex === 0}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={safeIndex >= queue.length - 1}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            Skip
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
