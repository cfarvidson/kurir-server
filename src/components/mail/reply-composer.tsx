"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { replyToMessage } from "@/actions/reply";
import { Send, CornerDownLeft, X, CalendarClock, Users } from "lucide-react";
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
import { useDraft } from "@/hooks/use-draft";
import { DraftStatusIndicator } from "@/components/mail/draft-status-indicator";
import { DraftType } from "@prisma/client";

const UNDO_DELAY_MS = 5000;

interface ReplyComposerProps {
  userId: string;
  messageId: string;
  replyToAddress: string;
  replyToName: string;
  replyAllExtraTo?: string[];
  replyAllCc?: string[];
  onSent?: (body: string) => void;
  subject: string;
  emailConnectionId: string;
  rfcMessageId?: string;
  references: string[];
  userTimezone: string;
  hasDraft?: boolean;
}

export function ReplyComposer({
  userId,
  messageId,
  replyToAddress,
  replyToName,
  replyAllExtraTo = [],
  replyAllCc = [],
  onSent,
  subject,
  emailConnectionId,
  rfcMessageId,
  references,
  userTimezone,
  hasDraft: hasDraftProp = false,
}: ReplyComposerProps) {
  const canReplyAll = replyAllExtraTo.length > 0 || replyAllCc.length > 0;
  const replyAllToString = [replyToAddress, ...replyAllExtraTo].join(", ");
  const replyAllCcString = replyAllCc.join(", ");

  const [isOpen, setIsOpen] = useState(hasDraftProp);
  const [body, setBody] = useState("");
  const [to, setTo] = useState(replyToAddress);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [isEditingTo, setIsEditingTo] = useState(false);
  const [isEditingCc, setIsEditingCc] = useState(false);
  const [isEditingBcc, setIsEditingBcc] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const [scheduling, setScheduling] = useState(false);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const { enqueue, cancel } = usePendingSendStore();
  const pendingSendIdRef = useRef<string | null>(null);
  const savedBodyRef = useRef("");
  const savedToRef = useRef("");
  const savedCcRef = useRef("");
  const savedBccRef = useRef("");
  const savedAttachmentsRef = useRef<UploadedAttachment[]>([]);
  const restoredFromDraftRef = useRef(false);

  const resetRecipients = useCallback(() => {
    setTo(replyToAddress);
    setCc("");
    setBcc("");
    setShowCc(false);
    setShowBcc(false);
    setIsEditingTo(false);
    setIsEditingCc(false);
    setIsEditingBcc(false);
    restoredFromDraftRef.current = false;
  }, [replyToAddress]);

  const {
    attachments,
    upload,
    remove,
    isUploading,
    setAttachments,
    getSnapshot,
  } = useAttachments();

  // Draft auto-save
  const {
    loadDraft,
    saveDraft,
    removeDraft,
    cancelPendingSave,
    status: draftStatus,
  } = useDraft(userId, DraftType.REPLY, messageId);
  const draftLoadedRef = useRef(false);

  // Restore draft on mount (always attempt, regardless of hasDraftProp)
  useEffect(() => {
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    loadDraft().then((draft) => {
      if (!draft) return;
      if (draft.body) {
        setBody(draft.body);
        setIsOpen(true);
      }
      if (draft.to && draft.to !== replyToAddress) {
        setTo(draft.to);
        restoredFromDraftRef.current = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip reset if to was restored from a draft with a custom recipient
    if (restoredFromDraftRef.current) return;
    if (!isEditingTo) setTo(replyToAddress);
  }, [replyToAddress, isEditingTo]);

  // Auto-save on content change
  const initialRenderRef = useRef(true);
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (!isOpen) return;
    const attachmentIds = attachments
      .filter((a) => a.status === "done")
      .map((a) => a.id);
    saveDraft({ to, subject: "", body, attachmentIds });
  }, [to, body, attachments, isOpen, saveDraft]);

  const openReplyAll = useCallback(() => {
    setTo(replyAllToString);
    setCc(replyAllCcString);
    setShowCc(replyAllCc.length > 0);
    restoredFromDraftRef.current = true;
    setIsOpen(true);
  }, [replyAllToString, replyAllCcString, replyAllCc.length]);

  // Listen for keyboard shortcuts to focus/open the reply composer
  useEffect(() => {
    const replyHandler = () => setIsOpen(true);
    const replyAllHandler = () => {
      if (canReplyAll) openReplyAll();
      else setIsOpen(true);
    };
    window.addEventListener("keyboard-reply", replyHandler);
    window.addEventListener("keyboard-reply-all", replyAllHandler);
    return () => {
      window.removeEventListener("keyboard-reply", replyHandler);
      window.removeEventListener("keyboard-reply-all", replyAllHandler);
    };
  }, [canReplyAll, openReplyAll]);

  const handleUndo = useCallback(() => {
    const sendId = pendingSendIdRef.current;
    if (sendId) {
      cancel(sendId);
      pendingSendIdRef.current = null;
    }
    setBody(savedBodyRef.current);
    setTo(savedToRef.current);
    setCc(savedCcRef.current);
    setBcc(savedBccRef.current);
    setShowCc(savedCcRef.current.trim().length > 0);
    setShowBcc(savedBccRef.current.trim().length > 0);
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
      cancelPendingSave();
      await removeDraft();
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
    cancelPendingSave();

    const sentBody = body.trim();
    const sentTo = to;
    const sentCc = cc.trim();
    const sentBcc = bcc.trim();
    const attachmentIds = attachments
      .filter((a) => a.status === "done")
      .map((a) => a.id);
    setError(null);

    // Save state for undo restoration
    savedBodyRef.current = sentBody;
    savedToRef.current = sentTo;
    savedCcRef.current = sentCc;
    savedBccRef.current = sentBcc;
    savedAttachmentsRef.current = getSnapshot();

    const sendId = `reply-${messageId}-${Date.now()}`;
    pendingSendIdRef.current = sendId;

    // Collapse composer immediately, reset to single-reply defaults
    setBody("");
    resetRecipients();
    setAttachments([]);
    setIsOpen(false);

    enqueue(
      {
        id: sendId,
        createdAt: Date.now(),
        delayMs: UNDO_DELAY_MS,
      },
      async () => {
        await replyToMessage(
          messageId,
          sentBody,
          sentTo,
          attachmentIds,
          sentCc || undefined,
          sentBcc || undefined,
        );
        await removeDraft();
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
        setCc(savedCcRef.current);
        setBcc(savedBccRef.current);
        setShowCc(savedCcRef.current.trim().length > 0);
        setShowBcc(savedBccRef.current.trim().length > 0);
        setAttachments(savedAttachmentsRef.current);
        setIsOpen(true);
        setError(errorMessage);
        toast.error(errorMessage);
      },
    );

    const extras = [sentCc && "cc", sentBcc && "bcc"].filter(Boolean).join(", ");
    const undoLabel = extras ? `${sentTo} (+${extras})` : sentTo;
    showUndoSendToast(sendId, undoLabel, UNDO_DELAY_MS, handleUndo, () => {});
  };

  return (
    <div className="relative">
      {!isOpen ? (
        <button
          data-reply-composer-trigger
          onClick={() => setIsOpen(true)}
          className={cn(
            "group flex w-full items-center gap-3 rounded-xl border bg-muted/30",
            "px-4 py-3.5 text-sm text-muted-foreground",
            "transition-all duration-200",
            "hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-xs",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <CornerDownLeft className="h-4 w-4" />
          <span className="flex-1 text-left">
            Reply to{" "}
            <span className="font-medium text-foreground">
              {to === replyToAddress ? replyToName : to}
            </span>
          </span>
          {canReplyAll && (
            <span
              role="button"
              tabIndex={0}
              data-reply-all-composer-trigger
              onClick={(e) => {
                e.stopPropagation();
                openReplyAll();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  openReplyAll();
                }
              }}
              title={`Reply all (${1 + replyAllExtraTo.length} to, ${replyAllCc.length} cc)`}
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground/70 transition-colors",
                "hover:bg-primary/10 hover:text-foreground",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Users className="h-3.5 w-3.5" />
            </span>
          )}
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
          <div className="flex items-start justify-between gap-2 border-b bg-muted/30 px-4 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {isEditingTo ? (
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-xs text-muted-foreground">To:</span>
                  <input
                    ref={toInputRef}
                    type="text"
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
                    className="flex-1 bg-transparent text-xs font-medium outline-hidden"
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
                  className="truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Click to edit recipient"
                >
                  To{" "}
                  <span className="font-medium text-foreground">
                    {to === replyToAddress ? replyToName : to}
                  </span>
                  {to === replyToAddress && (
                    <span className="text-muted-foreground/60">
                      {" "}
                      &lt;{to}&gt;
                    </span>
                  )}
                </button>
              )}
              {showCc &&
                (isEditingCc ? (
                  <div className="flex flex-1 items-center gap-2">
                    <span className="text-xs text-muted-foreground">Cc:</span>
                    <input
                      ref={ccInputRef}
                      type="text"
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                      onBlur={() => setIsEditingCc(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setIsEditingCc(false);
                        if (e.key === "Escape") setIsEditingCc(false);
                      }}
                      className="flex-1 bg-transparent text-xs font-medium outline-hidden"
                      placeholder="cc@example.com, ..."
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingCc(true);
                      setTimeout(() => ccInputRef.current?.select(), 0);
                    }}
                    className="truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    title="Click to edit Cc"
                  >
                    Cc{" "}
                    <span className="font-medium text-foreground">
                      {cc.trim() || "(empty)"}
                    </span>
                  </button>
                ))}
              {showBcc &&
                (isEditingBcc ? (
                  <div className="flex flex-1 items-center gap-2">
                    <span className="text-xs text-muted-foreground">Bcc:</span>
                    <input
                      ref={bccInputRef}
                      type="text"
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
                      onBlur={() => setIsEditingBcc(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setIsEditingBcc(false);
                        if (e.key === "Escape") setIsEditingBcc(false);
                      }}
                      className="flex-1 bg-transparent text-xs font-medium outline-hidden"
                      placeholder="bcc@example.com, ..."
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingBcc(true);
                      setTimeout(() => bccInputRef.current?.select(), 0);
                    }}
                    className="truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    title="Click to edit Bcc"
                  >
                    Bcc{" "}
                    <span className="font-medium text-foreground">
                      {bcc.trim() || "(empty)"}
                    </span>
                  </button>
                ))}
              {(!showCc || !showBcc) && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                  {!showCc && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCc(true);
                        setIsEditingCc(true);
                        setTimeout(() => ccInputRef.current?.focus(), 0);
                      }}
                      className="transition-colors hover:text-foreground"
                    >
                      + Add Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowBcc(true);
                        setIsEditingBcc(true);
                        setTimeout(() => bccInputRef.current?.focus(), 0);
                      }}
                      className="transition-colors hover:text-foreground"
                    >
                      + Add Bcc
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canReplyAll &&
                to === replyToAddress &&
                !cc.trim() &&
                !bcc.trim() && (
                  <button
                    type="button"
                    onClick={openReplyAll}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Reply all"
                  >
                    <Users className="h-3 w-3" />
                    Reply all
                  </button>
                )}
              <button
                onClick={() => {
                  const hasContent = body.trim() || attachments.length > 0;
                  if (hasContent && !confirm("Discard reply?")) return;
                  cancelPendingSave();
                  removeDraft();
                  setBody("");
                  setAttachments([]);
                  resetRecipients();
                  setIsOpen(false);
                }}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground/50">
                {typeof navigator !== "undefined" &&
                navigator.platform.includes("Mac")
                  ? "Cmd"
                  : "Ctrl"}
                +Enter to send
              </span>
              <DraftStatusIndicator status={draftStatus} />
            </div>
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
                    disabled={
                      !body.trim() ||
                      scheduling ||
                      isUploading ||
                      to.includes(",") ||
                      cc.trim().length > 0 ||
                      bcc.trim().length > 0
                    }
                    title={
                      to.includes(",") ||
                      cc.trim().length > 0 ||
                      bcc.trim().length > 0
                        ? "Scheduling is not available for multi-recipient replies yet"
                        : undefined
                    }
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
