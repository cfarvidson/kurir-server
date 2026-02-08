import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";

async function getThreadMessages(userId: string, messageId: string) {
  // First get the target message
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      messageId: true,
      inReplyTo: true,
      references: true,
      subject: true,
    },
  });

  if (!message) return null;

  // Collect all related message IDs for thread lookup
  const relatedIds = new Set<string>();
  if (message.threadId) relatedIds.add(message.threadId);
  if (message.messageId) relatedIds.add(message.messageId);
  if (message.inReplyTo) relatedIds.add(message.inReplyTo);
  for (const ref of message.references) {
    relatedIds.add(ref);
  }

  // Find thread messages: same threadId, or linked via references/inReplyTo
  const threadMessages = await db.message.findMany({
    where: {
      userId,
      OR: [
        ...(message.threadId ? [{ threadId: message.threadId }] : []),
        ...(relatedIds.size > 0
          ? [
              { messageId: { in: Array.from(relatedIds) } },
              { inReplyTo: { in: Array.from(relatedIds) } },
            ]
          : []),
        { id: messageId },
      ],
    },
    include: {
      sender: { select: { displayName: true, email: true } },
      attachments: {
        select: { id: true, filename: true, size: true },
      },
    },
    orderBy: { receivedAt: "asc" },
  });

  // Mark unread messages in thread as read
  const unreadIds = threadMessages
    .filter((m) => !m.isRead)
    .map((m) => m.id);
  if (unreadIds.length > 0) {
    await db.message.updateMany({
      where: { id: { in: unreadIds } },
      data: { isRead: true },
    });
  }

  return threadMessages;
}

async function getUserEmail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email || "";
}

export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const [messages, currentUserEmail] = await Promise.all([
    getThreadMessages(session.user.id, id),
    getUserEmail(session.user.id),
  ]);

  if (!messages || messages.length === 0) {
    notFound();
  }

  // The message that was clicked
  const targetMessage = messages.find((m) => m.id === id) || messages[0];
  const subject = targetMessage.subject || "(no subject)";

  // For reply: use the last message in the thread
  const lastMessage = messages[messages.length - 1];
  const replyToAddress = lastMessage.replyTo || lastMessage.fromAddress;
  const replyToName =
    lastMessage.sender?.displayName ||
    lastMessage.fromName ||
    lastMessage.fromAddress;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-4 md:px-6">
        <Link
          href="/imbox"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        {messages.length > 1 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {messages.length} messages
          </span>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
          {/* Subject */}
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{subject}</h1>

          {/* Messages + Reply */}
          <div className="mt-6 md:mt-8">
            <ThreadPageContent
              initialMessages={messages}
              currentUserEmail={currentUserEmail}
              replyToMessageId={lastMessage.id}
              replyToAddress={replyToAddress}
              replyToName={replyToName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
