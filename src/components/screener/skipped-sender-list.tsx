"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { approveSender, rejectSender, unskipSender } from "@/actions/senders";
import {
  X,
  Undo2,
  Loader2,
  Clock,
  Check,
  Inbox,
  Newspaper,
  Receipt,
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
  IMBOX: { label: "Imbox", Icon: Inbox, color: "text-imbox" },
  FEED: { label: "The Feed", Icon: Newspaper, color: "text-feed" },
  PAPER_TRAIL: { label: "Paper Trail", Icon: Receipt, color: "text-paper-trail" },
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

export function SkippedSenderList({ senders }: { senders: SkippedSender[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleReject = (senderId: string) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await rejectSender(senderId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  return (
    <div className="border-t border-border">
      <div className="px-4 py-4 md:px-6">
        <h2 className="eyebrow flex items-center gap-2 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Skipped <span className="tabular-nums">({senders.length})</span>
        </h2>
      </div>

      {senders.map((sender) => {
        const isProcessing = processingId === sender.id;
        const isExpanded = expandedId === sender.id;

        return (
          <div key={sender.id} className="border-b border-border">
            <div className="flex items-center gap-3 px-4 py-3.5 md:px-6">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">
                  {sender.displayName || sender.email}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {sender.email} &middot;{" "}
                  <span className="tabular-nums">
                    {sender._count.messages}
                  </span>{" "}
                  email(s) &middot;{" "}
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
                    className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {isExpanded && (
              <div className="flex flex-wrap gap-1 px-4 pb-3 md:px-6">
                {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                  const c = CATEGORY_CONFIG[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => handleApprove(sender.id, cat)}
                      disabled={isPending}
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted/50"
                    >
                      <c.Icon
                        className={cn("size-4 shrink-0", c.color)}
                        aria-hidden="true"
                      />
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
