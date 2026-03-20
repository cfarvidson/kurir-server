"use client";

import { useState, useEffect, useTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  approveSender,
  rejectSender,
  skipSender,
  undoScreenAction,
} from "@/actions/senders";
import { badgeUpdate } from "@/components/layout/sidebar";
import { ScreenerKeyboardHandler } from "@/components/screener/screener-keyboard-handler";
import { dismissScreenerHint } from "@/components/screener/screener-hint-banner";
import { EmailBodyFrame } from "@/components/mail/email-body-frame";
import { toast } from "sonner";
import { useCountdown } from "@/hooks/use-countdown";
import {
  Check,
  X,
  Inbox,
  Newspaper,
  Receipt,
  Loader2,
  Clock,
  ChevronDown,
  ArrowRight,
} from "lucide-react";

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

interface BodyCache {
  html: string | null;
  text: string | null;
  sizeBytes: number;
}

const MAX_PREVIEW_SIZE = 150 * 1024;
const UNDO_DELAY_MS = 5000;

function UndoScreenToastContent({
  senderName,
  action,
  delayMs,
  onUndo,
  onComplete,
}: {
  senderName: string;
  action: "in" | "out";
  delayMs: number;
  onUndo: () => void;
  onComplete: () => void;
}) {
  const { remaining, progress } = useCountdown(delayMs, onComplete);
  const seconds = Math.ceil(remaining / 1000);
  const circumference = 2 * Math.PI * 15;

  return (
    <div className="flex w-[360px] items-center gap-3 px-4 py-3">
      <div className="relative h-9 w-9 shrink-0">
        <svg className="-rotate-90 h-9 w-9" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-muted-foreground/15"
          />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * progress}
            strokeLinecap="round"
            className="text-primary transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
          {seconds}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Screened {action === "in" ? "in" : "out"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{senderName}</p>
      </div>

      <button
        onClick={onUndo}
        className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Undo
      </button>
    </div>
  );
}

export function ScreenerView({ senders: initialSenders }: ScreenerViewProps) {
  const router = useRouter();
  const [senders, setSenders] = useState(initialSenders);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSenders(initialSenders);
  }, [initialSenders]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState<string | null>(
    null,
  );

  // Preview state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [bodyCache, setBodyCache] = useState<Record<string, BodyCache>>({});

  // Track last interaction mode for focus management
  const lastInteractionRef = useRef<"keyboard" | "mouse">("mouse");

  const currentSender = senders[0];
  const latestMessage = currentSender?.messages[0];
  const isProcessing = currentSender
    ? processingId === currentSender.id
    : false;

  // Reset preview when card changes
  useEffect(() => {
    setIsPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError(false);
  }, [currentSender?.id]);

  const fetchBody = useCallback(
    async (messageId: string) => {
      if (bodyCache[messageId]) return;
      setPreviewLoading(true);
      setPreviewError(false);
      try {
        const res = await fetch(`/api/mail/message/${messageId}/body`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = (await res.json()) as BodyCache;
        setBodyCache((prev) => ({ ...prev, [messageId]: data }));
      } catch {
        setPreviewError(true);
      } finally {
        setPreviewLoading(false);
      }
    },
    [bodyCache],
  );

  const togglePreview = useCallback(() => {
    if (!latestMessage) return;
    if (isPreviewOpen) {
      setIsPreviewOpen(false);
    } else {
      setIsPreviewOpen(true);
      if (!bodyCache[latestMessage.id]) {
        fetchBody(latestMessage.id);
      }
    }
  }, [isPreviewOpen, latestMessage, bodyCache, fetchBody]);

  const showUndoToast = useCallback(
    (
      senderId: string,
      senderName: string,
      action: "in" | "out",
      prevSenders: Sender[],
    ) => {
      toast.custom(
        (id) => (
          <UndoScreenToastContent
            senderName={senderName}
            action={action}
            delayMs={UNDO_DELAY_MS}
            onUndo={() => {
              toast.dismiss(id);
              setSenders(prevSenders);
              badgeUpdate("screener", 1);
              startTransition(async () => {
                try {
                  await undoScreenAction(senderId);
                } catch {
                  setSenders((prev) =>
                    prev.filter((s) => s.id !== senderId),
                  );
                  badgeUpdate("screener", -1);
                }
                router.refresh();
              });
            }}
            onComplete={() => {
              toast.dismiss(id);
            }}
          />
        ),
        {
          duration: UNDO_DELAY_MS + 1000,
          id: `screener-undo-${senderId}`,
          unstyled: true,
        },
      );
    },
    [router, startTransition],
  );

  const handleApprove = async (
    senderId: string,
    category: Category = "IMBOX",
  ) => {
    const sender = senders.find((s) => s.id === senderId);
    const senderName =
      sender?.displayName || sender?.email || "Unknown sender";

    setProcessingId(senderId);
    setShowCategoryPicker(null);
    const prevSenders = [...senders];
    setSenders((prev) => prev.filter((s) => s.id !== senderId));
    badgeUpdate("screener", -1);

    showUndoToast(senderId, senderName, "in", prevSenders);

    startTransition(async () => {
      try {
        await approveSender(senderId, category);
      } catch {
        setSenders(prevSenders);
        badgeUpdate("screener", 1);
      }
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleReject = async (senderId: string) => {
    const sender = senders.find((s) => s.id === senderId);
    const senderName =
      sender?.displayName || sender?.email || "Unknown sender";

    setProcessingId(senderId);
    const prevSenders = [...senders];
    setSenders((prev) => prev.filter((s) => s.id !== senderId));
    badgeUpdate("screener", -1);

    showUndoToast(senderId, senderName, "out", prevSenders);

    startTransition(async () => {
      try {
        await rejectSender(senderId);
      } catch {
        setSenders(prevSenders);
        badgeUpdate("screener", 1);
      }
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleSkip = async (senderId: string) => {
    setProcessingId(senderId);
    const prevSenders = senders;
    setSenders((prev) => prev.filter((s) => s.id !== senderId));
    badgeUpdate("screener", -1);

    startTransition(async () => {
      try {
        await skipSender(senderId);
      } catch {
        setSenders(prevSenders);
        badgeUpdate("screener", 1);
      }
      setProcessingId(null);
      router.refresh();
    });
  };

  if (!currentSender) {
    return null;
  }

  const cachedBody = latestMessage ? bodyCache[latestMessage.id] : undefined;
  const isTruncated = cachedBody && cachedBody.sizeBytes > MAX_PREVIEW_SIZE;
  const previewHtml = cachedBody?.html ?? null;
  const previewText = cachedBody?.text ?? null;

  return (
    <div className="flex h-full items-center justify-center p-3 md:p-6">
      <ScreenerKeyboardHandler
        currentSenderId={currentSender.id}
        isProcessing={isProcessing}
        isCategoryPickerOpen={showCategoryPicker === currentSender.id}
        onApprove={(category) =>
          handleApprove(currentSender.id, category ?? "IMBOX")
        }
        onReject={() => {
          lastInteractionRef.current = "keyboard";
          handleReject(currentSender.id);
        }}
        onSkip={() => {
          lastInteractionRef.current = "keyboard";
          handleSkip(currentSender.id);
        }}
        onTogglePreview={togglePreview}
        onClosePreview={() => setIsPreviewOpen(false)}
        onCloseCategoryPicker={() => setShowCategoryPicker(null)}
        onOpenCategoryPicker={() =>
          setShowCategoryPicker(currentSender.id)
        }
        onDismissBanner={dismissScreenerHint}
        onKeyboardAction={() => {
          lastInteractionRef.current = "keyboard";
        }}
      />

      <div className="w-full max-w-lg">
        {/* Stable aria-live parent wrapping AnimatePresence */}
        <div aria-live="polite" aria-atomic="true" role="region" aria-label="Sender to screen">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSender.id}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden rounded-xl border bg-card shadow-lg"
              onAnimationComplete={() => {
                if (lastInteractionRef.current === "keyboard") {
                  const firstAction =
                    document.querySelector<HTMLButtonElement>(
                      '[data-screener-action="reject"]',
                    );
                  firstAction?.focus();
                }
              }}
            >
              {/* Sender Header */}
              <div className="border-b bg-muted/50 p-4 md:p-6">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary md:h-14 md:w-14 md:text-xl">
                    {(currentSender.displayName || currentSender.email)
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold md:text-lg">
                      {currentSender.displayName || currentSender.email}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground md:text-sm">
                      {currentSender.email}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground md:mt-4 md:text-sm">
                  <span>{currentSender._count.messages} email(s)</span>
                  <span>&middot;</span>
                  <span>from {currentSender.domain}</span>
                </div>
              </div>

              {/* Latest Message Preview */}
              {latestMessage && (
                <div className="p-4 md:p-6">
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

                  {/* Preview toggle */}
                  <button
                    className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => {
                      lastInteractionRef.current = "mouse";
                      togglePreview();
                    }}
                    aria-expanded={isPreviewOpen}
                    aria-controls="screener-preview"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isPreviewOpen && "rotate-180",
                      )}
                    />
                    {isPreviewOpen ? "Hide preview" : "Preview"}
                    <kbd
                      aria-hidden="true"
                      className="hidden h-[18px] min-w-[18px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground/60 md:inline-flex"
                    >
                      Space
                    </kbd>
                  </button>
                </div>
              )}

              {/* Email Body Preview */}
              <AnimatePresence>
                {isPreviewOpen && (
                  <motion.div
                    id="screener-preview"
                    role="region"
                    aria-label="Email preview"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    className="overflow-hidden border-t"
                  >
                    {previewLoading ? (
                      <div className="space-y-2.5 px-4 py-4 md:px-6">
                        <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                        <div className="pt-1" />
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                      </div>
                    ) : previewError ? (
                      <div className="px-4 py-6 text-center md:px-6">
                        <p className="text-sm text-muted-foreground">
                          Could not load email preview.
                        </p>
                        <button
                          onClick={() =>
                            latestMessage && fetchBody(latestMessage.id)
                          }
                          className="mt-1 cursor-pointer text-sm text-primary hover:underline"
                        >
                          Try again
                        </button>
                      </div>
                    ) : isTruncated ? (
                      <div className="flex items-center justify-between px-4 py-4 md:px-6">
                        <p className="text-sm text-muted-foreground">
                          This email is too large to preview here.
                        </p>
                        <a
                          href={`/imbox/${latestMessage?.id}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          View full email
                          <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ) : previewHtml || previewText ? (
                      <div className="relative overflow-hidden">
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-card to-transparent"
                        />
                        <div className="max-h-[400px] overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6">
                          {previewHtml ? (
                            <EmailBodyFrame html={previewHtml} />
                          ) : (
                            <pre className="whitespace-pre-wrap text-sm text-foreground">
                              {previewText}
                            </pre>
                          )}
                        </div>
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-card to-transparent"
                        />
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-center md:px-6">
                        <p className="text-sm italic text-muted-foreground">
                          No email body available.
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

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
                      <div
                        className="grid grid-cols-3 gap-2"
                        role="radiogroup"
                        aria-label="Email category"
                      >
                        <button
                          role="radio"
                          aria-checked={false}
                          aria-keyshortcuts="1"
                          onClick={() => {
                            lastInteractionRef.current = "mouse";
                            handleApprove(currentSender.id, "IMBOX");
                          }}
                          className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                        >
                          <Inbox className="h-5 w-5 text-primary" />
                          <span className="text-xs font-medium">Imbox</span>
                          <kbd
                            aria-hidden="true"
                            className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                          >
                            1
                          </kbd>
                        </button>
                        <button
                          role="radio"
                          aria-checked={false}
                          aria-keyshortcuts="2"
                          onClick={() => {
                            lastInteractionRef.current = "mouse";
                            handleApprove(currentSender.id, "FEED");
                          }}
                          className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                        >
                          <Newspaper className="h-5 w-5 text-blue-500" />
                          <span className="text-xs font-medium">The Feed</span>
                          <kbd
                            aria-hidden="true"
                            className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                          >
                            2
                          </kbd>
                        </button>
                        <button
                          role="radio"
                          aria-checked={false}
                          aria-keyshortcuts="3"
                          onClick={() => {
                            lastInteractionRef.current = "mouse";
                            handleApprove(currentSender.id, "PAPER_TRAIL");
                          }}
                          className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted"
                        >
                          <Receipt className="h-5 w-5 text-amber-500" />
                          <span className="text-xs font-medium">
                            Paper Trail
                          </span>
                          <kbd
                            aria-hidden="true"
                            className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                          >
                            3
                          </kbd>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="flex border-t">
                <button
                  data-screener-action="reject"
                  aria-keyshortcuts="n"
                  onClick={() => {
                    lastInteractionRef.current = "mouse";
                    handleReject(currentSender.id);
                  }}
                  disabled={isProcessing}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors md:gap-2 md:py-4 md:text-sm",
                    "border-r hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20",
                    isProcessing && "cursor-not-allowed opacity-50",
                  )}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" />
                  ) : (
                    <X className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                  <span className="hidden sm:inline">Screen Out</span>
                  <span className="sm:hidden">Out</span>
                  <kbd
                    aria-hidden="true"
                    className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                  >
                    N
                  </kbd>
                </button>
                <button
                  data-screener-action="skip"
                  aria-keyshortcuts="h"
                  onClick={() => {
                    lastInteractionRef.current = "mouse";
                    handleSkip(currentSender.id);
                  }}
                  disabled={isProcessing}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors md:gap-2 md:py-4 md:text-sm",
                    "border-r hover:bg-muted hover:text-muted-foreground active:bg-muted/80",
                    isProcessing && "cursor-not-allowed opacity-50",
                  )}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" />
                  ) : (
                    <Clock className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                  Skip
                  <kbd
                    aria-hidden="true"
                    className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                  >
                    H
                  </kbd>
                </button>
                <button
                  data-screener-action="approve"
                  aria-keyshortcuts="y"
                  onClick={() => {
                    lastInteractionRef.current = "mouse";
                    if (showCategoryPicker === currentSender.id) {
                      handleApprove(currentSender.id, "IMBOX");
                    } else {
                      setShowCategoryPicker(currentSender.id);
                    }
                  }}
                  disabled={isProcessing}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors md:gap-2 md:py-4 md:text-sm",
                    "hover:bg-green-50 hover:text-green-600 active:bg-green-100",
                    isProcessing && "cursor-not-allowed opacity-50",
                  )}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" />
                  ) : (
                    <Check className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                  <span className="hidden sm:inline">Screen In</span>
                  <span className="sm:hidden">In</span>
                  <kbd
                    aria-hidden="true"
                    className="hidden h-5 min-w-[18px] items-center justify-center rounded border border-border/70 bg-muted/50 px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] md:inline-flex"
                  >
                    Y
                  </kbd>
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Queue indicator */}
        {senders.length > 1 && (
          <div className="mt-4 flex justify-center gap-1">
            {senders.slice(0, 5).map((sender, i) => (
              <div
                key={sender.id}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i === 0 ? "bg-primary" : "bg-muted-foreground/30",
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
