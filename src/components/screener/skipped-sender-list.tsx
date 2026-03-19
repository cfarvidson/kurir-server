"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  approveSender,
  rejectSender,
  unskipSender,
} from "@/actions/senders";
import {
  Inbox,
  Newspaper,
  Receipt,
  X,
  Undo2,
  Loader2,
  Clock,
  Check,
} from "lucide-react";

import type { SenderCategory } from "@prisma/client";

interface SkippedSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  skippedUntil: Date | null;
  _count: { messages: number };
}

const CATEGORY_CONFIG = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: { label: "The Feed", icon: Newspaper, color: "text-blue-500" },
  PAPER_TRAIL: { label: "Paper Trail", icon: Receipt, color: "text-amber-500" },
} as const;

function formatTimeRemaining(until: Date | null): string {
  if (!until) return "";
  const diff = new Date(until).getTime() - Date.now();
  if (diff <= 0) return "returning soon";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SkippedSenderList({
  senders,
}: {
  senders: SkippedSender[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleUnskip = (senderId: string) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await unskipSender(senderId);
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleApprove = (senderId: string, category: SenderCategory) => {
    setProcessingId(senderId);
    setExpandedId(null);
    startTransition(async () => {
      await approveSender(senderId, category);
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleReject = (senderId: string) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await rejectSender(senderId);
      setProcessingId(null);
      router.refresh();
    });
  };

  return (
    <div className="border-t">
      <div className="px-6 py-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Skipped ({senders.length})
        </h2>
      </div>

      {senders.map((sender) => {
        const isProcessing = processingId === sender.id;
        const isExpanded = expandedId === sender.id;

        return (
          <div key={sender.id} className="border-b">
            <div className="flex items-center gap-3 px-6 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {(sender.displayName || sender.email).charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {sender.displayName || sender.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {sender.email} &middot; {sender._count.messages} email(s)
                  &middot;{" "}
                  <span className="text-muted-foreground/70">
                    returns in {formatTimeRemaining(sender.skippedUntil)}
                  </span>
                </div>
              </div>

              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleReject(sender.id)}
                    disabled={isPending}
                    title="Screen Out"
                    className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleUnskip(sender.id)}
                    disabled={isPending}
                    title="Unskip"
                    className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground hover:bg-muted/50"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      isExpanded
                        ? handleApprove(sender.id, "IMBOX")
                        : setExpandedId(sender.id)
                    }
                    disabled={isPending}
                    title="Screen In"
                    className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-green-600 hover:bg-green-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {isExpanded && (
              <div className="flex gap-2 px-6 pb-3 pl-17">
                {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                  const c = CATEGORY_CONFIG[cat];
                  const CatIcon = c.icon;
                  return (
                    <button
                      key={cat}
                      onClick={() => handleApprove(sender.id, cat)}
                      disabled={isPending}
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
