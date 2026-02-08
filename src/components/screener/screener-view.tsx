"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { approveSender, rejectSender } from "@/actions/senders";
import { Check, X, Inbox, Newspaper, Receipt, Loader2 } from "lucide-react";

interface Sender {
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
  _count: {
    messages: number;
  };
}

interface ScreenerViewProps {
  senders: Sender[];
}

type Category = "IMBOX" | "FEED" | "PAPER_TRAIL";

export function ScreenerView({ senders: initialSenders }: ScreenerViewProps) {
  const router = useRouter();
  const [senders, setSenders] = useState(initialSenders);
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState<string | null>(null);

  const currentSender = senders[0];

  const handleApprove = async (senderId: string, category: Category = "IMBOX") => {
    setProcessingId(senderId);
    setShowCategoryPicker(null);

    startTransition(async () => {
      await approveSender(senderId, category);
      setSenders((prev) => prev.filter((s) => s.id !== senderId));
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleReject = async (senderId: string) => {
    setProcessingId(senderId);

    startTransition(async () => {
      await rejectSender(senderId);
      setSenders((prev) => prev.filter((s) => s.id !== senderId));
      setProcessingId(null);
      router.refresh();
    });
  };

  if (!currentSender) {
    return null;
  }

  const latestMessage = currentSender.messages[0];
  const isProcessing = processingId === currentSender.id;

  return (
    <div className="flex h-full items-center justify-center p-3 md:p-6">
      <div className="w-full max-w-lg">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSender.id}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden rounded-xl border bg-card shadow-lg"
          >
            {/* Sender Header */}
            <div className="border-b bg-muted/50 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
                  {(currentSender.displayName || currentSender.email)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="truncate text-lg font-semibold">
                    {currentSender.displayName || currentSender.email}
                  </h3>
                  <p className="truncate text-sm text-muted-foreground">
                    {currentSender.email}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{currentSender._count.messages} email(s)</span>
                <span>•</span>
                <span>from {currentSender.domain}</span>
              </div>
            </div>

            {/* Latest Message Preview */}
            {latestMessage && (
              <div className="p-6">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Latest Message
                </p>
                <h4 className="mt-2 font-medium">
                  {latestMessage.subject || "(no subject)"}
                </h4>
                {latestMessage.snippet && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                    {latestMessage.snippet}
                  </p>
                )}
              </div>
            )}

            {/* Category Picker */}
            <AnimatePresence>
              {showCategoryPicker === currentSender.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t bg-muted/30"
                >
                  <div className="p-4">
                    <p className="mb-3 text-sm font-medium">
                      Where should their emails go?
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleApprove(currentSender.id, "IMBOX")}
                        className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                      >
                        <Inbox className="h-5 w-5 text-primary" />
                        <span className="text-xs font-medium">Imbox</span>
                      </button>
                      <button
                        onClick={() => handleApprove(currentSender.id, "FEED")}
                        className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                      >
                        <Newspaper className="h-5 w-5 text-blue-500" />
                        <span className="text-xs font-medium">The Feed</span>
                      </button>
                      <button
                        onClick={() => handleApprove(currentSender.id, "PAPER_TRAIL")}
                        className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                      >
                        <Receipt className="h-5 w-5 text-amber-500" />
                        <span className="text-xs font-medium">Paper Trail</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex border-t">
              <button
                onClick={() => handleReject(currentSender.id)}
                disabled={isProcessing}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 py-4 text-sm font-medium transition-colors",
                  "border-r hover:bg-destructive/10 hover:text-destructive",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <X className="h-5 w-5" />
                )}
                Screen Out
              </button>
              <button
                onClick={() => {
                  if (showCategoryPicker === currentSender.id) {
                    handleApprove(currentSender.id, "IMBOX");
                  } else {
                    setShowCategoryPicker(currentSender.id);
                  }
                }}
                disabled={isProcessing}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 py-4 text-sm font-medium transition-colors",
                  "hover:bg-green-50 hover:text-green-600",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Check className="h-5 w-5" />
                )}
                Screen In
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Queue indicator */}
        {senders.length > 1 && (
          <div className="mt-4 flex justify-center gap-1">
            {senders.slice(0, 5).map((sender, i) => (
              <div
                key={sender.id}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i === 0 ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            ))}
            {senders.length > 5 && (
              <span className="ml-1 text-xs text-muted-foreground">
                +{senders.length - 5} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
