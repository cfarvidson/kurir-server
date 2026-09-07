"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { ThreadView, type ThreadBranchLink, type ReplyMode } from "./thread-view";
import { ReplyComposer } from "./reply-composer";
import type { RemoteImagePolicy } from "@/lib/mail/image-policy";
import type { MeetingCardMeeting } from "@/lib/calendar/meeting-card";
import { answeredMessageIds, type ReplyOptions } from "@/lib/mail/thread-card";

interface ThreadMessage {
  id: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses?: string[];
  receivedAt: Date;
  sentAt: Date | null;
  textBody: string | null;
  htmlBody: string | null;
  isRead: boolean;
  isAnswered: boolean;
  isArchived?: boolean;
  snippet: string | null;
  sender?: {
    id?: string;
    displayName: string | null;
    email: string;
    allowRemoteImages?: boolean;
  } | null;
  attachments: {
    id: string;
    filename: string;
    size: number;
    contentId: string | null;
    contentType: string;
  }[];
  meeting?: MeetingCardMeeting | null;
}

interface ThreadPageContentProps {
  userId: string;
  initialMessages: ThreadMessage[];
  currentUserEmail: string;
  userEmails: string[];
  /** Reply parameters per card (db id → options), computed server-side. */
  replyOptions: Record<string, ReplyOptions>;
  /** Card the composer targets when the thread opens. */
  initialReplyTargetId: string;
  /** Cards that already have a saved reply draft. */
  draftContextIds?: string[];
  branches?: ThreadBranchLink[];
  emailConnectionId: string;
  userTimezone: string;
  remoteImagePolicy?: RemoteImagePolicy;
  recipientNames?: Record<string, string>;
  hasWritableCalendar?: boolean;
}

export function ThreadPageContent({
  userId,
  initialMessages,
  currentUserEmail,
  userEmails,
  replyOptions,
  initialReplyTargetId,
  draftContextIds = [],
  branches = [],
  emailConnectionId,
  userTimezone,
  remoteImagePolicy = "BLOCK_ALL",
  recipientNames = {},
  hasWritableCalendar = false,
}: ThreadPageContentProps) {
  const userEmailSet = useMemo(
    () => new Set(userEmails.map((e) => e.toLowerCase())),
    [userEmails],
  );
  const isOwn = useCallback(
    (address: string) => userEmailSet.has(address.trim().toLowerCase()),
    [userEmailSet],
  );
  const [messages, setMessages] = useState(initialMessages);

  // The card the composer replies to (plan 055). A card's Reply button moves
  // it; the composer is keyed on it so each target keeps its own draft.
  const [replyTargetId, setReplyTargetId] = useState(initialReplyTargetId);
  const [openRequest, setOpenRequest] = useState<{
    mode: ReplyMode;
    nonce: number;
  } | null>(null);
  const [draftIds, setDraftIds] = useState(() => new Set(draftContextIds));

  const target = replyOptions[replyTargetId] ?? replyOptions[initialReplyTargetId];

  const answeredIds = useMemo(
    () => answeredMessageIds(messages, isOwn),
    [messages, isOwn],
  );
  const replyAllIds = useMemo(
    () =>
      new Set(
        Object.values(replyOptions)
          .filter((o) => o.replyAllExtraTo.length > 0 || o.replyAllCc.length > 0)
          .map((o) => o.messageId),
      ),
    [replyOptions],
  );

  const handleCardReply = useCallback((messageId: string, mode: ReplyMode) => {
    setReplyTargetId(messageId);
    setOpenRequest((prev) => ({ mode, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // The composer is keyed on the target, so by the time this effect runs the
  // composer for the new target is mounted and listening for the same events
  // the r / a shortcuts dispatch.
  useEffect(() => {
    if (!openRequest) return;
    window.dispatchEvent(
      new CustomEvent(
        openRequest.mode === "replyAll" ? "keyboard-reply-all" : "keyboard-reply",
      ),
    );
  }, [openRequest]);

  const handleDraftPresence = useCallback(
    (hasDraft: boolean) => {
      setDraftIds((prev) => {
        if (prev.has(replyTargetId) === hasDraft) return prev;
        const next = new Set(prev);
        if (hasDraft) next.add(replyTargetId);
        else next.delete(replyTargetId);
        return next;
      });
    },
    [replyTargetId],
  );

  const scrollRef = useRef(0);

  // Continuously track scroll position so we have it when router.refresh()
  // re-renders the page (which can reset the scroll container).
  useEffect(() => {
    const el = document.querySelector(
      "[data-thread-scroll]",
    ) as HTMLElement | null;
    if (!el) return;
    const handler = () => {
      scrollRef.current = el.scrollTop;
    };
    scrollRef.current = el.scrollTop;
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [messages]);

  // Sync messages from server (triggered by router.refresh / revalidation)
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Restore scroll position BEFORE paint when messages change
  useLayoutEffect(() => {
    const el = document.querySelector(
      "[data-thread-scroll]",
    ) as HTMLElement | null;
    if (el && scrollRef.current > 0 && el.scrollTop !== scrollRef.current) {
      el.scrollTop = scrollRef.current;
    }
  }, [messages]);

  const handleReplySent = (body: string) => {
    const optimisticMessage: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      messageId: null,
      // Marks the target card "replied" before the sent copy syncs in.
      inReplyTo: target?.rfcMessageId ?? null,
      subject: null,
      fromAddress: currentUserEmail,
      fromName: null,
      toAddresses: [target?.replyToAddress ?? ""],
      ccAddresses: [],
      receivedAt: new Date(),
      sentAt: new Date(),
      textBody: body,
      htmlBody: null,
      isRead: true,
      isAnswered: false,
      snippet: body.length > 150 ? body.slice(0, 150) + "..." : body,
      sender: null,
      attachments: [],
      meeting: null,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
  };

  return (
    <>
      <ThreadView
        messages={messages}
        currentUserEmail={currentUserEmail}
        userEmails={userEmailSet}
        replyTargetId={replyTargetId}
        answeredIds={answeredIds}
        draftIds={draftIds}
        replyAllIds={replyAllIds}
        onReply={handleCardReply}
        branches={branches}
        remoteImagePolicy={remoteImagePolicy}
        recipientNames={recipientNames}
        hasWritableCalendar={hasWritableCalendar}
        timezone={userTimezone}
      />

      {target && (
        <div className="mt-6 pb-8">
          <ReplyComposer
            key={target.messageId}
            userId={userId}
            messageId={target.messageId}
            replyToAddress={target.replyToAddress}
            replyToName={target.replyToName}
            replyAllExtraTo={target.replyAllExtraTo}
            replyAllCc={target.replyAllCc}
            onSent={handleReplySent}
            subject={target.subject}
            emailConnectionId={emailConnectionId}
            rfcMessageId={target.rfcMessageId}
            references={target.references}
            userTimezone={userTimezone}
            hasDraft={draftIds.has(target.messageId)}
            onDraftPresence={handleDraftPresence}
          />
        </div>
      )}
    </>
  );
}
