"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { replyToMessage } from "@/actions/reply";
import { Send, Loader2, CornerDownLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReplyComposerProps {
  messageId: string;
  replyToAddress: string;
  replyToName: string;
  onSent?: (body: string) => void;
}

export function ReplyComposer({
  messageId,
  replyToAddress,
  replyToName,
  onSent,
}: ReplyComposerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [to, setTo] = useState(replyToAddress);
  const [isEditingTo, setIsEditingTo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!isEditingTo) setTo(replyToAddress);
  }, [replyToAddress, isEditingTo]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 300) + "px";
    }
  };

  const handleSend = () => {
    if (!body.trim() || isPending || sendingRef.current) return;
    sendingRef.current = true;

    const sentBody = body.trim();
    setError(null);
    startTransition(async () => {
      try {
        await replyToMessage(messageId, sentBody, to);
        onSent?.(sentBody);
        setSent(true);
        setBody("");
        setTimeout(() => {
          setSent(false);
          setIsOpen(false);
          sendingRef.current = false;
        }, 1500);
      } catch (err) {
        sendingRef.current = false;
        setError(
          err instanceof Error ? err.message : "Failed to send reply"
        );
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      if (!body.trim()) {
        setIsOpen(false);
      }
    }
  };

  return (
    <div className="relative">
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-4 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Reply sent
          </motion.div>
        ) : !isOpen ? (
          <motion.button
            key="collapsed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            onClick={() => setIsOpen(true)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/20",
              "px-4 py-3.5 text-sm text-muted-foreground",
              "transition-all duration-200",
              "hover:border-primary/30 hover:bg-primary/[0.02] hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <CornerDownLeft className="h-4 w-4" />
            <span>
              Reply to{" "}
              <span className="font-medium text-foreground">
                {to === replyToAddress ? replyToName : to}
              </span>
            </span>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden rounded-xl border shadow-sm"
          >
            {/* Composer header */}
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
              {isEditingTo ? (
                <div className="flex flex-1 items-center gap-2 mr-2">
                  <span className="text-xs text-muted-foreground">To:</span>
                  <input
                    ref={toInputRef}
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    onBlur={() => {
                      if (to.trim()) setIsEditingTo(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && to.trim()) {
                        setIsEditingTo(false);
                        textareaRef.current?.focus();
                      }
                      if (e.key === "Escape") {
                        setTo(replyToAddress);
                        setIsEditingTo(false);
                      }
                    }}
                    className="flex-1 bg-transparent text-xs font-medium outline-none"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingTo(true);
                    setTimeout(() => toInputRef.current?.select(), 0);
                  }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Click to edit recipient"
                >
                  To{" "}
                  <span className="font-medium text-foreground">
                    {to === replyToAddress ? replyToName : to}
                  </span>{" "}
                  <span className="text-muted-foreground/60">
                    &lt;{to}&gt;
                  </span>
                </button>
              )}
              <button
                onClick={() => {
                  if (body.trim()) {
                    if (confirm("Discard reply?")) {
                      setBody("");
                      setIsOpen(false);
                    }
                  } else {
                    setIsOpen(false);
                  }
                }}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Textarea */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                autoFocus
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  autoResize();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Write your reply..."
                disabled={isPending}
                className={cn(
                  "block w-full resize-none bg-transparent px-4 py-3 text-sm",
                  "placeholder:text-muted-foreground/50",
                  "focus:outline-none",
                  "disabled:opacity-50",
                  "min-h-[100px]"
                )}
                rows={4}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-muted/20 px-3 py-2">
              <span className="text-[11px] text-muted-foreground/50">
                {typeof navigator !== "undefined" &&
                navigator.platform.includes("Mac")
                  ? "Cmd"
                  : "Ctrl"}
                +Enter to send
              </span>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!body.trim() || isPending}
                className="gap-1.5"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
