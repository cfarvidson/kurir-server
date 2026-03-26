"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  approveSender,
  rejectSender,
  changeSenderCategory,
} from "@/actions/senders";
import { Inbox, Newspaper, Receipt, X, Loader2 } from "lucide-react";

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
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: { label: "The Feed", icon: Newspaper, color: "text-blue-500" },
  PAPER_TRAIL: { label: "Paper Trail", icon: Receipt, color: "text-amber-500" },
} as const;

export function ScreenedSenderList({ senders }: { senders: ScreenedSender[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleChangeCategory = (senderId: string, category: SenderCategory) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await changeSenderCategory(senderId, category);
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

  const handleApprove = (
    senderId: string,
    category: SenderCategory = "IMBOX",
  ) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await approveSender(senderId, category);
      setProcessingId(null);
      router.refresh();
    });
  };

  const approved = senders.filter((s) => s.status === "APPROVED");
  const rejected = senders.filter((s) => s.status === "REJECTED");

  return (
    <div className="border-t">
      <div className="px-6 py-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Previously Screened
        </h2>
      </div>

      {approved.length > 0 && (
        <section>
          <div className="bg-muted/30 px-6 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Approved ({approved.length})
            </span>
          </div>
          {approved.map((sender) => {
            const isProcessing = processingId === sender.id;
            const config = CATEGORY_CONFIG[sender.category ?? "IMBOX"];
            const Icon = config.icon;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b px-6 py-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {(sender.displayName || sender.email).charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {sender.email} &middot; {sender._count.messages} email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-1">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const CatIcon = c.icon;
                      const isActive = sender.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => handleChangeCategory(sender.id, cat)}
                          disabled={isPending}
                          title={c.label}
                          className={cn(
                            "rounded-md p-1.5 transition-colors",
                            isActive
                              ? `${c.color} bg-muted`
                              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          <CatIcon className="h-4 w-4" />
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleReject(sender.id)}
                      disabled={isPending}
                      title="Reject"
                      className="ml-1 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-destructive hover:bg-destructive/10"
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
          <div className="bg-muted/30 px-6 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Rejected ({rejected.length})
            </span>
          </div>
          {rejected.map((sender) => {
            const isProcessing = processingId === sender.id;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b px-6 py-3 opacity-60"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {(sender.displayName || sender.email).charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {sender.email} &middot; {sender._count.messages} email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-1">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const CatIcon = c.icon;
                      return (
                        <button
                          key={cat}
                          onClick={() => handleApprove(sender.id, cat)}
                          disabled={isPending}
                          title={`Approve to ${c.label}`}
                          className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-muted/50"
                        >
                          <CatIcon className="h-4 w-4" />
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
