"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { ThreadView } from "./thread-view";
import { ReplyComposer } from "./reply-composer";
import { hasDraftInLocalStorage } from "@/hooks/use-draft";
import { DraftType } from "@prisma/client";

interface ThreadMessage {
  id: string;
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
  sentAt: Date | null;
  textBody: string | null;
  htmlBody: string | null;
  isRead: boolean;
  isAnswered: boolean;
  isArchived?: boolean;
  snippet: string | null;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
  attachments: {
    id: string;
    filename: string;
    size: number;
    contentId: string | null;
  }[];
}

interface ThreadPageContentProps {
  userId: string;
  initialMessages: ThreadMessage[];
  currentUserEmail: string;
  userEmails: string[];
  replyToMessageId: string;
  replyToAddress: string;
  replyToName: string;
  subject: string;
  emailConnectionId: string;
  rfcMessageId?: string;
  references: string[];
  userTimezone: string;
}

export function ThreadPageContent({
  userId,
  initialMessages,
  currentUserEmail,
  userEmails,
  replyToMessageId,
  replyToAddress,
  replyToName,
  subject,
  emailConnectionId,
  rfcMessageId,
  references,
  userTimezone,
}: ThreadPageContentProps) {
  const userEmailSet = useMemo(
    () => new Set(userEmails.map((e) => e.toLowerCase())),
    [userEmails],
  );
  const [messages, setMessages] = useState(initialMessages);

  // Check for saved draft (defer to avoid hydration mismatch)
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    setHasDraft(
      hasDraftInLocalStorage(userId, DraftType.REPLY, replyToMessageId),
    );
  }, [userId, replyToMessageId]);
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
      subject: null,
      fromAddress: currentUserEmail,
      fromName: null,
      toAddresses: [replyToAddress],
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
    };

    setMessages((prev) => [...prev, optimisticMessage]);
  };

  return (
    <>
      <ThreadView
        messages={messages}
        currentUserEmail={currentUserEmail}
        userEmails={userEmailSet}
      />

      <div className="mt-6 pb-8">
        <ReplyComposer
          userId={userId}
          messageId={replyToMessageId}
          replyToAddress={replyToAddress}
          replyToName={replyToName}
          onSent={handleReplySent}
          subject={subject}
          emailConnectionId={emailConnectionId}
          rfcMessageId={rfcMessageId}
          references={references}
          userTimezone={userTimezone}
          hasDraft={hasDraft}
        />
      </div>
    </>
  );
}
