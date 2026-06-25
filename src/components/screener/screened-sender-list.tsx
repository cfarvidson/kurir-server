"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  approveSender,
  rejectSender,
  changeSenderCategory,
} from "@/actions/senders";
import { X, Loader2, Check } from "lucide-react";

import type { SenderStatus, SenderCategory } from "@prisma/client";

interface ScreenedSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  status: SenderStatus;
  category: SenderCategory | null;
  decidedAt: Date | null;
  _count: { messages: number };
}

const CATEGORY_CONFIG = {
  IMBOX: { label: "Imbox", dot: "bg-imbox" },
  FEED: { label: "The Feed", dot: "bg-feed" },
  PAPER_TRAIL: { label: "Paper Trail", dot: "bg-paper-trail" },
} as const;

export function ScreenedSenderList({ senders }: { senders: ScreenedSender[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleChangeCategory = (senderId: string, category: SenderCategory) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await changeSenderCategory(senderId, category);
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

  const handleApprove = (
    senderId: string,
    category: SenderCategory = "IMBOX",
  ) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await approveSender(senderId, category);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const approved = senders.filter((s) => s.status === "APPROVED");
  const rejected = senders.filter((s) => s.status === "REJECTED");

  return (
    <div className="border-t border-border">
      <div className="px-4 py-4 md:px-6">
        <h2 className="eyebrow text-muted-foreground">Previously Screened</h2>
      </div>

      {approved.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Approved{" "}
              <span className="tabular-nums">({approved.length})</span>
            </span>
          </div>
          {approved.map((sender) => {
            const isProcessing = processingId === sender.id;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {sender.email} &middot;{" "}
                    <span className="tabular-nums">
                      {sender._count.messages}
                    </span>{" "}
                    email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const isActive = sender.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => handleChangeCategory(sender.id, cat)}
                          disabled={isPending}
                          title={c.label}
                          aria-pressed={isActive}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/50 hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              c.dot,
                            )}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                          {isActive && (
                            <Check
                              className="h-3 w-3 text-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleReject(sender.id)}
                      disabled={isPending}
                      title="Reject"
                      className="ml-1 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Rejected{" "}
              <span className="tabular-nums">({rejected.length})</span>
            </span>
          </div>
          {rejected.map((sender) => {
            const isProcessing = processingId === sender.id;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 opacity-60 md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {sender.email} &middot;{" "}
                    <span className="tabular-nums">
                      {sender._count.messages}
                    </span>{" "}
                    email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => handleApprove(sender.id, cat)}
                          disabled={isPending}
                          title={`Approve to ${c.label}`}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              c.dot,
                            )}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
