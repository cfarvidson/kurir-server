"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ThreadView } from "./thread-view";
import { ReplyComposer } from "./reply-composer";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

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

    // Scroll to the new message
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  return (
    <>
      <ThreadView
        messages={messages}
        currentUserEmail={currentUserEmail}
        userEmails={userEmailSet}
      />

      <div className="mt-6 pb-8" ref={bottomRef}>
        <ReplyComposer
          messageId={replyToMessageId}
          replyToAddress={replyToAddress}
          replyToName={replyToName}
          onSent={handleReplySent}
          subject={subject}
          emailConnectionId={emailConnectionId}
          rfcMessageId={rfcMessageId}
          references={references}
          userTimezone={userTimezone}
        />
      </div>
    </>
  );
}
