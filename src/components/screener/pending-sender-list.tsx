"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { approveSender, rejectSender, skipSender } from "@/actions/senders";
import { runOptimisticSenderAction } from "@/lib/mail/optimistic-sender";
import { Inbox, Newspaper, Receipt, X, Clock, Check } from "lucide-react";

import type { SenderCategory } from "@prisma/client";

interface PendingSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  messages: {
    id: string;
    subject: string | null;
    snippet: string | null;
    receivedAt: Date;
  }[];
  _count: { messages: number };
}

const CATEGORY_CONFIG = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: { label: "The Feed", icon: Newspaper, color: "text-blue-500" },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color: "text-amber-500",
  },
} as const;

export function PendingSenderList({ senders }: { senders: PendingSender[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Synchronous per-sender guard so a rapid double-click (before the optimistic
  // removal re-renders) can't fire the action twice.
  const processingIds = useRef<Set<string>>(new Set());

  const claim = (senderId: string): boolean => {
    if (processingIds.current.has(senderId)) return false;
    processingIds.current.add(senderId);
    return true;
  };
  const markRemoved = (senderId: string) =>
    setRemovedIds((prev) => new Set(prev).add(senderId));
  const restore = (senderId: string) => {
    // Failed action — make the sender actionable again.
    processingIds.current.delete(senderId);
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(senderId);
      return next;
    });
  };
  // Reconcile counts/lists in the background without blocking the click.
  const reconcile = () => {
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    startTransition(() => router.refresh());
  };

  const handleApprove = (senderId: string, category: SenderCategory) => {
    setExpandedId(null);
    if (!claim(senderId)) return;
    runOptimisticSenderAction({
      action: () => approveSender(senderId, category),
      applyOptimistic: () => markRemoved(senderId),
      revert: () => restore(senderId),
      reconcile,
      errorLabel: "Couldn't screen in sender — please try again",
    });
  };

  const handleReject = (senderId: string) => {
    if (!claim(senderId)) return;
    runOptimisticSenderAction({
      action: () => rejectSender(senderId),
      applyOptimistic: () => markRemoved(senderId),
      revert: () => restore(senderId),
      reconcile,
      errorLabel: "Couldn't screen out sender — please try again",
    });
  };

  const handleSkip = (senderId: string) => {
    if (!claim(senderId)) return;
    runOptimisticSenderAction({
      action: () => skipSender(senderId),
      applyOptimistic: () => markRemoved(senderId),
      revert: () => restore(senderId),
      reconcile,
      errorLabel: "Couldn't skip sender — please try again",
    });
  };

  const visibleSenders = senders.filter((s) => !removedIds.has(s.id));

  return (
    <div className="border-t">
      <div className="px-6 py-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Pending ({visibleSenders.length})
        </h2>
      </div>

      {visibleSenders.map((sender) => {
        const isExpanded = expandedId === sender.id;

        return (
          <div key={sender.id} className="border-b">
            <div className="flex items-center gap-3 px-6 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {sender.displayName || sender.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {sender.email} &middot; {sender._count.messages} email(s)
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleReject(sender.id)}
                  title="Screen Out"
                  className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-destructive hover:bg-destructive/10"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleSkip(sender.id)}
                  title="Skip"
                  className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground hover:bg-muted/50"
                >
                  <Clock className="h-4 w-4" />
                </button>
                <button
                  onClick={() =>
                    isExpanded
                      ? handleApprove(sender.id, "IMBOX")
                      : setExpandedId(sender.id)
                  }
                  title="Screen In"
                  className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-green-600 hover:bg-green-50"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="flex gap-2 px-6 pb-3">
                {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                  const c = CATEGORY_CONFIG[cat];
                  const CatIcon = c.icon;
                  return (
                    <button
                      key={cat}
                      onClick={() => handleApprove(sender.id, cat)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted",
                        c.color,
                      )}
                    >
                      <CatIcon className="h-3.5 w-3.5" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
