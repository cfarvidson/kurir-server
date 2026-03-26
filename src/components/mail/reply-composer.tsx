"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { replyToMessage } from "@/actions/reply";
import { Send, CornerDownLeft, X, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownComposer } from "@/components/mail/markdown-composer";
import {
  useAttachments,
  type UploadedAttachment,
} from "@/hooks/use-attachments";
import { SchedulePicker } from "@/components/mail/schedule-picker";
import { usePendingSendStore } from "@/stores/pending-send-store";
import { showUndoSendToast } from "@/components/mail/undo-send-toast";
import { createScheduledMessage } from "@/actions/scheduled-messages";
import { toast } from "sonner";

const UNDO_DELAY_MS = 5000;

interface ReplyComposerProps {
  messageId: string;
  replyToAddress: string;
  replyToName: string;
  onSent?: (body: string) => void;
  subject: string;
  emailConnectionId: string;
  rfcMessageId?: string;
  references: string[];
  userTimezone: string;
}

export function ReplyComposer({
  messageId,
  replyToAddress,
  replyToName,
  onSent,
  subject,
  emailConnectionId,
  rfcMessageId,
  references,
  userTimezone,
}: ReplyComposerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [to, setTo] = useState(replyToAddress);
  const [isEditingTo, setIsEditingTo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const [scheduling, setScheduling] = useState(false);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const { enqueue, cancel } = usePendingSendStore();
  const pendingSendIdRef = useRef<string | null>(null);
  const savedBodyRef = useRef("");
  const savedToRef = useRef("");
  const savedAttachmentsRef = useRef<UploadedAttachment[]>([]);

  const {
    attachments,
    upload,
    remove,
    isUploading,
    setAttachments,
    getSnapshot,
  } = useAttachments();

  useEffect(() => {
    if (!isEditingTo) setTo(replyToAddress);
  }, [replyToAddress, isEditingTo]);

  // Listen for keyboard shortcut "r" to focus/open the reply composer
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
    };
    window.addEventListener("keyboard-reply", handler);
    return () => window.removeEventListener("keyboard-reply", handler);
  }, []);

  const handleUndo = useCallback(() => {
    const sendId = pendingSendIdRef.current;
    if (sendId) {
      cancel(sendId);
      pendingSendIdRef.current = null;
    }
    setBody(savedBodyRef.current);
    setTo(savedToRef.current);
    setAttachments(savedAttachmentsRef.current);
    setIsOpen(true);
    setError(null);
    sendingRef.current = false;
  }, [cancel, setAttachments]);

  const handleScheduleSend = async (scheduledFor: Date) => {
    if (!body.trim() || scheduling || isUploading) return;
    setScheduling(true);
    try {
      const replySubject = subject.startsWith("Re:")
        ? subject
        : `Re: ${subject}`;
      const refsString = [
        ...references,
        ...(rfcMessageId && !references.includes(rfcMessageId)
          ? [rfcMessageId]
          : []),
      ].join(" ");

      const attachmentIds = attachments
        .filter((a) => a.status === "done")
        .map((a) => a.id);

      await createScheduledMessage({
        to: to.trim(),
        subject: replySubject,
        textBody: body.trim(),
        scheduledFor: scheduledFor.toISOString(),
        emailConnectionId,
        inReplyToMessageId: rfcMessageId,
        references: refsString || undefined,
        attachmentIds,
      });
      toast.success("Reply scheduled");
      setBody("");
      setAttachments([]);
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setScheduling(false);
    }
  };

  const handleSend = () => {
    if (!body.trim() || sendingRef.current || scheduling || isUploading) return;
    sendingRef.current = true;

    const sentBody = body.trim();
    const sentTo = to;
    const attachmentIds = attachments
      .filter((a) => a.status === "done")
      .map((a) => a.id);
    setError(null);

    // Save state for undo restoration
    savedBodyRef.current = sentBody;
    savedToRef.current = sentTo;
    savedAttachmentsRef.current = getSnapshot();

    const sendId = `reply-${messageId}-${Date.now()}`;
    pendingSendIdRef.current = sendId;

    // Collapse composer immediately
    setBody("");
    setAttachments([]);
    setIsOpen(false);

    enqueue(
      {
        id: sendId,
        createdAt: Date.now(),
        delayMs: UNDO_DELAY_MS,
      },
      async () => {
        await replyToMessage(messageId, sentBody, sentTo, attachmentIds);
        onSent?.(sentBody);
      },
      () => {
        pendingSendIdRef.current = null;
        sendingRef.current = false;
        toast.success("Reply sent");
      },
      (errorMessage) => {
        pendingSendIdRef.current = null;
        sendingRef.current = false;
        setBody(savedBodyRef.current);
        setTo(savedToRef.current);
        setAttachments(savedAttachmentsRef.current);
        setIsOpen(true);
        setError(errorMessage);
        toast.error(errorMessage);
      },
    );

    showUndoSendToast(sendId, sentTo, UNDO_DELAY_MS, handleUndo, () => {});
  };

  return (
    <div className="relative">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border bg-muted/30",
            "px-4 py-3.5 text-sm text-muted-foreground",
            "transition-all duration-200",
            "hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <CornerDownLeft className="h-4 w-4" />
          <span>
            Reply to{" "}
            <span className="font-medium text-foreground">
              {to === replyToAddress ? replyToName : to}
            </span>
          </span>
        </button>
      ) : (
        <motion.div
          key="expanded"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="overflow-hidden rounded-xl border shadow-md ring-1 ring-primary/10"
        >
          {/* Composer header */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            {isEditingTo ? (
              <div className="mr-2 flex flex-1 items-center gap-2">
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
                <span className="text-muted-foreground/60">&lt;{to}&gt;</span>
              </button>
            )}
            <button
              onClick={() => {
                if (body.trim() || attachments.length > 0) {
                  if (confirm("Discard reply?")) {
                    setBody("");
                    setAttachments([]);
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

          {/* Markdown composer */}
          <div className="px-4 py-3">
            <MarkdownComposer
              value={body}
              onChange={setBody}
              placeholder="Write your reply..."
              disabled={sendingRef.current}
              attachments={attachments}
              onFileUpload={upload}
              onFileRemove={remove}
              onSubmit={handleSend}
              onSchedule={() => setSchedulePickerOpen(true)}
              onCancel={() => {
                if (!body.trim() && attachments.length === 0) {
                  setIsOpen(false);
                }
              }}
              minHeight={100}
              autoFocus
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
            <div className="flex items-center gap-1">
              <SchedulePicker
                onSchedule={handleScheduleSend}
                userTimezone={userTimezone}
                isPending={scheduling}
                open={schedulePickerOpen}
                onOpenChange={setSchedulePickerOpen}
                side="top"
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    disabled={!body.trim() || scheduling || isUploading}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!body.trim() || scheduling || isUploading}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
