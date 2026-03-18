import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";
import { getThreadMessages } from "@/lib/mail/threads";
import { pushFlagsToImap } from "@/lib/mail/flag-push";
import { SidebarRefresh } from "@/components/mail/sidebar-refresh";
import { ContactSidebar } from "@/components/mail/contact-sidebar";

async function getUserInfo(userId: string, connectionId: string) {
  const [conn, user] = await Promise.all([
    db.emailConnection.findFirst({
      where: { id: connectionId, userId },
      select: { email: true, sendAsEmail: true, aliases: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
  ]);
  const allEmails = new Set(
    [conn?.email, conn?.sendAsEmail, ...(conn?.aliases ?? [])]
      .filter(Boolean)
      .map((e) => e!.trim().toLowerCase()),
  );
  return {
    email: conn?.email || "",
    allEmails,
    timezone: user?.timezone || "UTC",
  };
}

interface ThreadDetailViewProps {
  messageId: string;
  categoryLabel: string;
  returnPath: string;
  searchQuery?: string;
  actions: (props: {
    messageId: string;
    returnPath: string;
    timezone: string;
    followUpAt: Date | null;
    isFollowUp: boolean;
  }) => React.ReactNode;
  isSentView?: boolean;
}

export async function ThreadDetailView({
  messageId,
  categoryLabel,
  returnPath: baseReturnPath,
  searchQuery,
  actions,
  isSentView = false,
}: ThreadDetailViewProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const returnPath = searchQuery
    ? `${baseReturnPath}?q=${encodeURIComponent(searchQuery)}`
    : baseReturnPath;

  const threadResult = await getThreadMessages(session.user.id, messageId);

  if (!threadResult || threadResult.messages.length === 0) {
    notFound();
  }

  const { messages, markedRead } = threadResult;

  const targetMessage =
    messages.find((m) => m.id === messageId) || messages[0];
  const userInfo = await getUserInfo(
    session.user.id,
    targetMessage.emailConnectionId,
  );
  const currentUserEmail = userInfo.email;
  const userEmails = userInfo.allEmails;

  // Push \Seen to IMAP for messages just marked read (fire-and-forget)
  if (markedRead.length > 0) {
    pushFlagsToImap(session.user.id, markedRead, "\\Seen", "add").catch(
      console.error,
    );
  }

  const subject = targetMessage.subject || "(no subject)";

  // For threading: always reference the actual last message
  const lastMessage = messages[messages.length - 1];

  // For reply address: find the last message from someone else (not yourself)
  // Check all user emails (email, sendAsEmail, aliases) to avoid replying to self
  const lastIncoming = [...messages]
    .reverse()
    .find((m) => !userEmails.has(m.fromAddress.toLowerCase()));

  let replyToAddress: string;
  let replyToName: string;

  if (lastIncoming) {
    replyToAddress = lastIncoming.replyTo || lastIncoming.fromAddress;
    replyToName =
      lastIncoming.sender?.displayName ||
      lastIncoming.fromName ||
      lastIncoming.fromAddress;
  } else if (isSentView) {
    // Sent-only thread: reply to the recipient, not yourself
    const recipientEmail =
      lastMessage.toAddresses[0] || lastMessage.fromAddress;
    replyToAddress = recipientEmail;
    const recipientSender = await db.sender.findFirst({
      where: { userId: session.user.id, email: recipientEmail },
      select: { displayName: true },
    });
    replyToName = recipientSender?.displayName || recipientEmail;
  } else {
    // All messages are from the user — reply to the last recipient
    const recipientEmail =
      lastMessage.toAddresses.find((a) => !userEmails.has(a.toLowerCase())) ||
      lastMessage.toAddresses[0] ||
      lastMessage.fromAddress;
    replyToAddress = recipientEmail;
    const recipientSender = await db.sender.findFirst({
      where: { userId: session.user.id, email: recipientEmail },
      select: { displayName: true },
    });
    replyToName = recipientSender?.displayName || recipientEmail;
  }

  // Determine contact email for sidebar
  // For incoming threads: use the original sender (first message from someone else)
  // For sent-only threads: use the primary recipient
  const firstExternalMessage = messages.find(
    (m) => !userEmails.has(m.fromAddress.toLowerCase()),
  );
  const contactEmail = firstExternalMessage
    ? firstExternalMessage.fromAddress.toLowerCase()
    : messages[0].toAddresses.find(
          (a) => !userEmails.has(a.toLowerCase()),
        )?.toLowerCase() ||
      messages[0].toAddresses[0]?.toLowerCase() ||
      null;

  return (
    <div className="flex h-full flex-col">
      {markedRead.length > 0 && <SidebarRefresh />}
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur-sm md:px-6">
        <Link
          href={returnPath}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {categoryLabel}
          </span>
        </div>
        {messages.length > 1 && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium tabular-nums text-primary">
            {messages.length}
          </span>
        )}
        {actions({
          messageId,
          returnPath,
          timezone: userInfo.timezone,
          followUpAt: targetMessage.followUpAt,
          isFollowUp: targetMessage.isFollowUp,
        })}
      </div>

      {/* Thread + optional contact sidebar */}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-8">
            <h1 className="text-lg font-bold tracking-tight text-foreground md:text-2xl">
              {subject}
            </h1>

            <div className="mt-3 md:mt-6">
              <ThreadPageContent
                initialMessages={messages}
                currentUserEmail={currentUserEmail}
                replyToMessageId={lastMessage.id}
                replyToAddress={replyToAddress}
                replyToName={replyToName}
                subject={subject}
                emailConnectionId={targetMessage.emailConnectionId}
                rfcMessageId={lastMessage.messageId ?? undefined}
                references={lastMessage.references}
                userTimezone={userInfo.timezone}
              />
            </div>
          </div>
        </div>
        {contactEmail && (
          <ContactSidebar
            userId={session.user.id}
            contactEmail={contactEmail}
          />
        )}
      </div>
    </div>
  );
}
