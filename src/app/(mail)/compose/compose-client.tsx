"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FromPicker, type FromConnection } from "@/components/mail/from-picker";
import { MarkdownComposer } from "@/components/mail/markdown-composer";
import {
  useAttachments,
  type UploadedAttachment,
} from "@/hooks/use-attachments";
import { Send, X, Loader2, BookUser, CalendarClock, Users } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  RecipientGroupChip,
  type ComposeGroup,
  type AddedGroupState,
} from "@/components/mail/recipient-group-chip";
import {
  expandGroups,
  mergeRecipients,
  type RecipientTarget,
} from "@/lib/mail/group-expansion";
import { usePendingSendStore } from "@/stores/pending-send-store";
import { showUndoSendToast } from "@/components/mail/undo-send-toast";
import { SchedulePicker } from "@/components/mail/schedule-picker";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import {
  createScheduledMessage,
  editScheduledMessage,
  cancelScheduledMessage,
} from "@/actions/scheduled-messages";
import { parseRecipients } from "@/lib/mail/recipients";
import { safeInternalPath } from "@/lib/mail/compose-origin";
import { toast } from "sonner";
import { useDraft } from "@/hooks/use-draft";
import { DraftStatusIndicator } from "@/components/mail/draft-status-indicator";
import { DraftType } from "@prisma/client";

const UNDO_DELAY_MS = 5000;

interface ContactSuggestion {
  id: string;
  email: string;
  displayName: string | null;
}

function useContactSearch(query: string) {
  const [results, setResults] = useState<ContactSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (query.trim().length < 1) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // aborted or failed
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { results, loading };
}

export interface ForwardData {
  subject: string;
  body: string;
  attachments: UploadedAttachment[];
}

/** Pre-populated data when editing an existing PENDING scheduled message. */
export interface EditScheduledData {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** ISO string of the current scheduled send time. */
  scheduledFor: string;
  emailConnectionId: string;
  attachments: UploadedAttachment[];
  /** True when the stored body could not be decrypted; body must not be re-saved. */
  bodyDecryptFailed?: boolean;
}

interface ComposeClientPageProps {
  /** Current user's ID for draft keying */
  userId: string;
  /** All email connections for the current user */
  connections: FromConnection[];
  /** The connection ID to pre-select (e.g. from reply context) */
  defaultConnectionId?: string;
  /** User's IANA timezone for the schedule picker */
  userTimezone?: string;
  /** Pre-populated forward data */
  forwardData?: ForwardData;
  /** Pre-populated data when editing an existing scheduled message */
  editScheduled?: EditScheduledData;
  /** The user's saved contact groups, for the recipient group picker */
  groups?: ComposeGroup[];
}

export function ComposeClientPage({
  userId,
  connections,
  defaultConnectionId,
  userTimezone = "UTC",
  forwardData,
  editScheduled,
  groups = [],
}: ComposeClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forwardMessageId = searchParams.get("forward");
  // Where to return on cancel/escape — the view the user came from, falling
  // back to the Imbox when no (or an unsafe) origin was provided.
  const origin = safeInternalPath(searchParams.get("from")) ?? "/imbox";
  const isEditingScheduled = !!editScheduled;
  const [to, setTo] = useState(
    editScheduled?.to ?? searchParams.get("to") ?? "",
  );
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [addedGroups, setAddedGroups] = useState<AddedGroupState[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [subject, setSubject] = useState(
    editScheduled?.subject ?? forwardData?.subject ?? "",
  );
  const [body, setBody] = useState(editScheduled?.body ?? forwardData?.body ?? "");
  const [fromConnectionId, setFromConnectionId] = useState(
    editScheduled?.emailConnectionId ??
      defaultConnectionId ??
      connections.find((c) => c.isDefault)?.id ??
      connections[0]?.id ??
      "",
  );
  const [error, setError] = useState<string | null>(null);
  const {
    attachments,
    upload,
    remove,
    isUploading,
    setAttachments,
    getSnapshot,
  } = useAttachments();
  const savedAttachmentsRef = useRef<UploadedAttachment[]>([]);

  // Draft auto-save
  const draftType = forwardMessageId ? DraftType.FORWARD : DraftType.NEW;
  const draftContextId = forwardMessageId ?? "__new__";
  const {
    loadDraft,
    saveDraft,
    removeDraft,
    cancelPendingSave,
    status: draftStatus,
  } = useDraft(userId, draftType, draftContextId);
  const draftLoadedRef = useRef(false);

  // Pre-load forward / scheduled-edit attachments
  useEffect(() => {
    const initial = editScheduled?.attachments ?? forwardData?.attachments;
    if (initial?.length) {
      setAttachments(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore draft on mount
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    // When editing a scheduled message, the ScheduledMessage row is the source
    // of truth — skip the draft system entirely so the "__new__" draft can't
    // clobber the pre-filled content.
    if (isEditingScheduled) {
      draftRestoredRef.current = true;
      return;
    }
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    loadDraft().then((draft) => {
      if (!draft) {
        draftRestoredRef.current = true;
        return;
      }
      // Draft wins if body differs from forward pre-population (user made edits)
      const isStaleForward = forwardData && draft.body === forwardData.body;
      if (isStaleForward) {
        draftRestoredRef.current = true;
        return;
      }

      if (draft.to) setTo(draft.to);
      if (draft.subject) setSubject(draft.subject);
      if (draft.body) setBody(draft.body);
      if (draft.emailConnectionId) setFromConnectionId(draft.emailConnectionId);
      draftRestoredRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on content change (gated on draft restoration completing)
  useEffect(() => {
    if (isEditingScheduled) return; // no drafts while editing a scheduled message
    if (!draftRestoredRef.current) return;
    const attachmentIds = attachments
      .filter((a) => a.status === "done")
      .map((a) => a.id);
    saveDraft({
      to,
      subject,
      body,
      emailConnectionId: fromConnectionId,
      attachmentIds,
    });
  }, [to, subject, body, fromConnectionId, attachments, saveDraft]);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isTyping, setIsTyping] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const searchQuery = isTyping ? to : "";
  const { results, loading } = useContactSearch(searchQuery);

  const { enqueue, cancel, pendingSends } = usePendingSendStore();
  const hasPending = Object.keys(pendingSends).length > 0;
  useBeforeUnload(hasPending);

  const selectContact = useCallback((contact: ContactSuggestion) => {
    setTo(contact.email);
    setShowSuggestions(false);
    setIsTyping(false);
    setSelectedIndex(-1);
  }, []);

  const handleToChange = (value: string) => {
    setTo(value);
    setIsTyping(true);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      selectContact(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // --- Contact groups ---------------------------------------------------
  const addedGroupIds = new Set(addedGroups.map((g) => g.group.id));
  const availableGroups = groups.filter((g) => !addedGroupIds.has(g.id));

  const addGroup = (group: ComposeGroup) => {
    const target: RecipientTarget = group.defaultTarget === "BCC" ? "bcc" : "to";
    if (target === "bcc") setShowBcc(true);
    setAddedGroups((prev) => [
      ...prev,
      { group, target, removedMemberIds: new Set<string>() },
    ]);
    setGroupPickerOpen(false);
  };

  const updateGroup = (
    groupId: string,
    fn: (s: AddedGroupState) => AddedGroupState,
  ) => {
    setAddedGroups((prev) =>
      prev.map((s) => (s.group.id === groupId ? fn(s) : s)),
    );
  };

  const moveGroupTarget = (groupId: string, target: RecipientTarget) => {
    if (target === "cc") setShowCc(true);
    if (target === "bcc") setShowBcc(true);
    updateGroup(groupId, (s) => ({ ...s, target }));
  };

  const toggleGroupMember = (groupId: string, memberId: string) => {
    updateGroup(groupId, (s) => {
      const removed = new Set(s.removedMemberIds);
      if (removed.has(memberId)) removed.delete(memberId);
      else removed.add(memberId);
      return { ...s, removedMemberIds: removed };
    });
  };

  const dismissGroup = (groupId: string) => {
    setAddedGroups((prev) => prev.filter((s) => s.group.id !== groupId));
  };

  const groupsForTarget = (target: RecipientTarget) =>
    addedGroups.filter((s) => s.target === target);

  // Merge typed recipients with expanded group addresses for each field.
  // Returns null (and sets an error) if any typed address is malformed or no
  // recipient is present across all fields.
  const buildRecipients = ():
    | { to: string; cc: string; bcc: string; display: string }
    | null => {
    const toParsed = parseRecipients(to);
    const ccParsed = parseRecipients(cc);
    const bccParsed = parseRecipients(bcc);
    const invalid = [
      ...toParsed.invalid,
      ...ccParsed.invalid,
      ...bccParsed.invalid,
    ];
    if (invalid.length > 0) {
      setError(`Invalid recipient address: ${invalid.join(", ")}`);
      return null;
    }

    const expanded = expandGroups(
      addedGroups.map((s) => ({
        groupId: s.group.id,
        target: s.target,
        members: s.group.members.map((m) => ({
          memberId: m.memberId,
          email: m.email,
        })),
        removedMemberIds: s.removedMemberIds,
      })),
    );

    // Merge typed + group-expanded recipients, deduping across To/Cc/Bcc so a
    // person typed into one field and pulled in by a group targeting another
    // is neither delivered twice nor leaked from Bcc into a visible field.
    const {
      to: finalTo,
      cc: finalCc,
      bcc: finalBcc,
    } = mergeRecipients(
      {
        to: toParsed.recipients,
        cc: ccParsed.recipients,
        bcc: bccParsed.recipients,
      },
      expanded,
    );

    if (finalTo.length + finalCc.length + finalBcc.length === 0) {
      setError("Please enter a recipient");
      return null;
    }

    return {
      to: finalTo.join(", "),
      cc: finalCc.join(", "),
      bcc: finalBcc.join(", "),
      display:
        finalTo.join(", ") || finalCc.join(", ") || finalBcc.join(", "),
    };
  };

  const handleScheduleSend = async (scheduledFor: Date) => {
    // Scheduled sends store a single `to` string with no Cc/Bcc columns yet,
    // so scheduling Cc/Bcc or groups is not supported (deferred). Send now instead.
    if (cc.trim() || bcc.trim() || addedGroups.length > 0) {
      setError(
        "Scheduling doesn't support Cc, Bcc, or groups yet — send now instead.",
      );
      return;
    }
    const { recipients, invalid } = parseRecipients(to);
    if (invalid.length > 0) {
      setError(`Invalid recipient address: ${invalid.join(", ")}`);
      return;
    }
    if (recipients.length === 0) {
      setError("Please enter a recipient");
      return;
    }
    if (isUploading) {
      setError("Please wait for uploads to finish");
      return;
    }
    setScheduling(true);
    try {
      const attachmentIds = attachments
        .filter((a) => a.status === "done")
        .map((a) => a.id);
      if (editScheduled) {
        // Update the existing scheduled message rather than creating a duplicate.
        await editScheduledMessage(editScheduled.id, {
          to: to.trim(),
          subject,
          // When the original body couldn't be decrypted at load time, omit
          // textBody so the existing ciphertext is preserved rather than
          // overwritten with an empty (encrypted) body.
          ...(editScheduled.bodyDecryptFailed ? {} : { textBody: body }),
          scheduledFor: scheduledFor.toISOString(),
          emailConnectionId: fromConnectionId,
          attachmentIds,
        });
        toast.success("Schedule updated");
      } else {
        await createScheduledMessage({
          to: to.trim(),
          subject,
          textBody: body,
          scheduledFor: scheduledFor.toISOString(),
          emailConnectionId: fromConnectionId,
          attachmentIds,
        });
        cancelPendingSave();
        await removeDraft();
        toast.success("Message scheduled");
      }
      router.push("/scheduled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setScheduling(false);
    }
  };

  const handleSend = () => {
    const built = buildRecipients();
    if (!built) return;
    if (isUploading) {
      setError("Please wait for uploads to finish");
      return;
    }

    setError(null);
    cancelPendingSave();

    const sendId = `send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const attachmentIds = attachments
      .filter((a) => a.status === "done")
      .map((a) => a.id);
    const payload = {
      to: built.to,
      cc: built.cc,
      bcc: built.bcc,
      display: built.display,
      subject,
      body,
      fromConnectionId: connections.length > 1 ? fromConnectionId : undefined,
      attachmentIds,
    };

    // Save state for undo
    savedAttachmentsRef.current = getSnapshot();

    const pendingSend = {
      id: sendId,
      createdAt: Date.now(),
      delayMs: UNDO_DELAY_MS,
    };

    const onExpire = async () => {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          text: payload.body,
          fromConnectionId: payload.fromConnectionId,
          attachmentIds: payload.attachmentIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send email");
      }

      // When sending now from an edit of a scheduled message, cancel the
      // pending copy so it doesn't also fire later (double-send). Done only
      // after the send actually commits, so an Undo leaves the schedule intact.
      // The email has already been delivered here, so a cancel failure (e.g. the
      // scheduler raced us and the row is no longer PENDING) is a cleanup
      // problem — log it, but don't surface it as a send failure or skip the
      // draft cleanup below.
      if (editScheduled) {
        try {
          await cancelScheduledMessage(editScheduled.id);
        } catch (cancelErr) {
          console.error(
            "Failed to cancel scheduled copy after send-now:",
            cancelErr,
          );
        }
      } else {
        // Delete draft after successful send (undo window has expired).
        // Drafts are disabled while editing a scheduled message.
        await removeDraft();
      }
    };

    const onSuccess = () => {
      toast.success("Message sent");
    };

    const onError = (errorMsg: string) => {
      toast.error(errorMsg);
    };

    enqueue(pendingSend, onExpire, onSuccess, onError);

    showUndoSendToast(
      sendId,
      payload.display,
      UNDO_DELAY_MS,
      () => {
        cancel(sendId);
        // Restore state on undo — but we've already navigated away
        // so this is mostly for the toast feedback
        toast.success("Send cancelled");
      },
      () => {},
    );

    router.push("/imbox");
  };

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const hasSuggestions =
    showSuggestions && isTyping && (results.length > 0 || loading);
  const hasMultipleConnections = connections.length > 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold md:text-2xl">
            {isEditingScheduled ? "Edit Scheduled Message" : "New Message"}
          </h1>
          {editScheduled && (
            <p
              className="truncate text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              Scheduled for{" "}
              {new Date(editScheduled.scheduledFor).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
                timeZone: userTimezone,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          {!isEditingScheduled && <DraftStatusIndicator status={draftStatus} />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              cancelPendingSave();
              if (!isEditingScheduled) removeDraft();
              router.push(origin);
            }}
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={handleSend}>
              <Send className="h-4 w-4" />
              Send
            </Button>
            <SchedulePicker
              onSchedule={handleScheduleSend}
              userTimezone={userTimezone}
              isPending={scheduling}
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="px-2"
                  disabled={scheduling}
                >
                  <CalendarClock className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* From picker — only shown when user has multiple connections */}
          {hasMultipleConnections && (
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <FromPicker
                connections={connections}
                value={fromConnectionId}
                onChange={setFromConnectionId}
                className="w-full"
              />
            </div>
          )}

          {/* To field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="to">To</Label>
              <div className="flex items-center gap-2 text-xs">
                {!showCc && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCc(true)}
                  >
                    Add Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setShowBcc(true)}
                  >
                    Add Bcc
                  </button>
                )}
                <Popover
                  open={groupPickerOpen}
                  onOpenChange={setGroupPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Add group
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-1">
                    {groups.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        No groups yet — create one in Contacts.
                      </p>
                    ) : availableGroups.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        All groups added.
                      </p>
                    ) : (
                      <ul className="max-h-64 overflow-auto">
                        {availableGroups.map((g) => (
                          <li key={g.id}>
                            <button
                              type="button"
                              onClick={() => addGroup(g)}
                              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted/60"
                            >
                              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {g.name}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {g.members.length}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="relative">
              <Input
                ref={inputRef}
                id="to"
                type="email"
                placeholder="Start typing a name or email..."
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                onFocus={() => {
                  if (isTyping && to.trim()) setShowSuggestions(true);
                }}
                onKeyDown={handleToKeyDown}
                autoComplete="off"
              />

              {/* Contact suggestions dropdown */}
              {hasSuggestions && (
                <div
                  ref={suggestionsRef}
                  className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg"
                >
                  {loading && results.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Searching contacts...
                    </div>
                  ) : (
                    results.map((contact, i) => (
                      <button
                        key={contact.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectContact(contact);
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          i === selectedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {(contact.displayName || contact.email)
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          {contact.displayName ? (
                            <>
                              <div className="truncate font-medium">
                                {contact.displayName}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {contact.email}
                              </div>
                            </>
                          ) : (
                            <div className="truncate">{contact.email}</div>
                          )}
                        </div>
                        <BookUser className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {groupsForTarget("to").length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {groupsForTarget("to").map((s) => (
                  <RecipientGroupChip
                    key={s.group.id}
                    state={s}
                    onToggleMember={(mid) =>
                      toggleGroupMember(s.group.id, mid)
                    }
                    onMoveTarget={(t) => moveGroupTarget(s.group.id, t)}
                    onDismiss={() => dismissGroup(s.group.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Cc field */}
          {showCc && (
            <div className="space-y-2">
              <Label htmlFor="cc">Cc</Label>
              <Input
                id="cc"
                type="email"
                placeholder="Cc recipients..."
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                autoComplete="off"
              />
              {groupsForTarget("cc").length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {groupsForTarget("cc").map((s) => (
                    <RecipientGroupChip
                      key={s.group.id}
                      state={s}
                      onToggleMember={(mid) =>
                        toggleGroupMember(s.group.id, mid)
                      }
                      onMoveTarget={(t) => moveGroupTarget(s.group.id, t)}
                      onDismiss={() => dismissGroup(s.group.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bcc field */}
          {showBcc && (
            <div className="space-y-2">
              <Label htmlFor="bcc">Bcc</Label>
              <Input
                id="bcc"
                type="email"
                placeholder="Bcc recipients..."
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                autoComplete="off"
              />
              {groupsForTarget("bcc").length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {groupsForTarget("bcc").map((s) => (
                    <RecipientGroupChip
                      key={s.group.id}
                      state={s}
                      onToggleMember={(mid) =>
                        toggleGroupMember(s.group.id, mid)
                      }
                      onMoveTarget={(t) => moveGroupTarget(s.group.id, t)}
                      onDismiss={() => dismissGroup(s.group.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="What's this about?"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <MarkdownComposer
              value={body}
              onChange={setBody}
              placeholder="Write your message..."
              attachments={attachments}
              onFileUpload={upload}
              onFileRemove={remove}
              onSubmit={handleSend}
              onSchedule={() => setScheduleOpen(true)}
              onCancel={() => router.push(origin)}
              minHeight={300}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
