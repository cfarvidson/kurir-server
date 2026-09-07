import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Split } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";
import {
  getThreadMessages,
  branchesOf,
  splitOriginOf,
} from "@/lib/mail/threads";
import {
  defaultReplyTargetId,
  replyOptionsFor,
  type ReplyOptions,
} from "@/lib/mail/thread-card";
import { resolveRecipientName } from "@/lib/mail/recipient-names";
import { formatDate } from "@/lib/date";
import { resolveImagePolicy } from "@/lib/mail/image-policy";
import { threadKeyOf } from "@/lib/mail/thread-key";
import { pushFlagsToImap } from "@/lib/mail/flag-push";
import { SidebarRefresh } from "@/components/mail/sidebar-refresh";
import { PersonPaneTarget } from "@/components/mail/person-pane-bindings";
import { personEmailFor } from "@/lib/mail/person-pane";
import { ThreadKeyboardHandler } from "@/components/mail/thread-keyboard-handler";
import { MobileThreadActions } from "@/components/mail/mobile-thread-actions";
import { UnthreadToggle } from "@/components/mail/unthread-toggle";
import { ScreenDomainMenu } from "@/components/screener/screen-domain-menu";
import { ScreenSubjectMenu } from "@/components/screener/screen-subject-menu";
import { stripReplyPrefixes } from "@/lib/mail/subject-rules";
import { BackFallback } from "@/components/mail/back-fallback";
import { cn } from "@/lib/utils";
import { getOwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";
import { findReplyDraftsForThread } from "@/lib/mail/draft-presentation-db";
import { serializeMessageMeeting } from "@/lib/calendar/meeting-card";

async function getUserInfo(userId: string, connectionId: string) {
  const [conn, user, own, writableCalendars] = await Promise.all([
    db.emailConnection.findFirst({
      where: { id: connectionId, userId },
      select: { email: true, sendAsEmail: true, aliases: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { timezone: true, blockRemoteImages: true, blockTrackers: true },
    }),
    getOwnAddresses(userId),
    db.calendar.count({
      where: { userId, isReadOnly: false },
    }),
  ]);
  const allEmails = new Set(own.emails);
  return {
    email: conn?.email || "",
    allEmails,
    own,
    timezone: user?.timezone || "UTC",
    remoteImagePolicy: resolveImagePolicy({
      blockRemoteImages: user?.blockRemoteImages ?? true,
      blockTrackers: user?.blockTrackers ?? true,
    }),
    hasWritableCalendar: writableCalendars > 0,
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
    threadKey: string;
    threadId: string | null;
    timezone: string;
    followUpAt: Date | null;
    isFollowUp: boolean;
    isReplyLater: boolean;
  }) => React.ReactNode;
  isSentView?: boolean;
  mobileActions?: {
    showArchive?: boolean;
    showSnooze?: boolean;
    showFollowUp?: boolean;
  };
  hideHeaderActionsOnMobile?: boolean;
}

export async function ThreadDetailView({
  messageId,
  categoryLabel,
  returnPath: baseReturnPath,
  searchQuery,
  actions,
  isSentView = false,
  mobileActions,
  hideHeaderActionsOnMobile = false,
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

  const targetMessage = messages.find((m) => m.id === messageId) || messages[0];
  // Thread collapse key so the list components / pending-archive store can drop
  // every sibling row of this thread on optimistic archive.
  const threadKey = threadKeyOf(targetMessage);
  // The raw threadId as well: for unthreaded senders the key above is
  // per-message, but archive/unarchive expand to all threadId siblings
  // server-side, so the optimistic suppression needs both.
  const threadId = targetMessage.threadId ?? null;
  const userInfo = await getUserInfo(
    session.user.id,
    targetMessage.emailConnectionId,
  );
  const currentUserEmail = userInfo.email;
  const userEmails = userInfo.allEmails;
  const isOwn = (addr: string) =>
    userEmails.has(addr.trim().toLowerCase()) ||
    isOwnAddress(addr, userInfo.own);

  // Push \Seen to IMAP for messages just marked read (fire-and-forget)
  if (markedRead.length > 0) {
    pushFlagsToImap(session.user.id, markedRead, "\\Seen", "add").catch(
      console.error,
    );
  }

  const subject = targetMessage.subject || "(no subject)";

  // Resolve recipient addresses across the whole thread to names in two
  // batched queries (avoids N+1): contacts first, then the Sender rows for
  // addresses without a contact (so "You → Corp A" and "Reply to Corp A" read
  // the same as the list). Falls back to the raw address.
  const recipientAddresses = [
    ...new Set(
      messages
        .flatMap((m) => [...m.toAddresses, ...m.ccAddresses])
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const recipientNames: Record<string, string> = {};
  if (recipientAddresses.length > 0) {
    const recipientContacts = await db.contactEmail.findMany({
      where: {
        email: { in: recipientAddresses },
        contact: { userId: session.user.id },
      },
      select: { email: true, contact: { select: { name: true } } },
    });
    for (const ce of recipientContacts) {
      recipientNames[ce.email.toLowerCase()] = ce.contact.name;
    }
    const unnamed = recipientAddresses.filter((a) => !recipientNames[a]);
    if (unnamed.length > 0) {
      const senders = await db.sender.findMany({
        where: { userId: session.user.id, email: { in: unnamed } },
        select: { email: true, displayName: true },
      });
      for (const sender of senders) {
        if (sender.displayName) {
          recipientNames[sender.email.toLowerCase()] = sender.displayName;
        }
      }
    }
  }
  const nameFor = (address: string) =>
    resolveRecipientName(address, recipientNames);

  // Per-card reply parameters (plan 055): the composer targets whichever
  // card the user picks, so every card gets its own recipients/threading.
  const replyOptions: Record<string, ReplyOptions> = {};
  for (const m of messages) {
    replyOptions[m.id] = replyOptionsFor(m, isOwn, nameFor);
  }

  const replyDrafts = await findReplyDraftsForThread(
    session.user.id,
    messages.map((m) => m.id),
  );
  const draftContextIds = replyDrafts.map((d) => d.contextMessageId);
  const initialReplyTargetId =
    defaultReplyTargetId(messages, isOwn, replyDrafts[0]?.contextMessageId) ??
    targetMessage.id;

  // Split threads (plan 055): the broadcast lists the branches that opened
  // from it; a branch links back to the broadcast.
  const splitOrigin = await splitOriginOf(session.user.id, messages);
  const branches =
    !splitOrigin && targetMessage.threadId
      ? await branchesOf(session.user.id, targetMessage.threadId)
      : [];

  // Person for the pane: the original sender (first message from someone
  // else), else the same rule the list rows use (first external To/Cc;
  // never an own address, so a note to self shows nobody).
  const firstExternalMessage = messages.find(
    (m) => !userEmails.has(m.fromAddress.toLowerCase()),
  );
  const contactEmail = firstExternalMessage
    ? firstExternalMessage.fromAddress.toLowerCase()
    : personEmailFor(messages[0], userEmails);

  return (
    <div className="flex h-full flex-col">
      <ThreadKeyboardHandler messageId={messageId} returnPath={returnPath} />
      <BackFallback path={returnPath} />
      {markedRead.length > 0 && <SidebarRefresh />}
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xs md:px-6">
        <Link
          href={returnPath}
          className="flex min-w-0 flex-1 items-center gap-3 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="eyebrow text-muted-foreground">{categoryLabel}</span>
        </Link>
        {messages.length > 1 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            ·{messages.length}
          </span>
        )}
        {targetMessage.sender && !isSentView && (
          <>
            {targetMessage.sender.email.includes("@") && (
              <>
                <ScreenSubjectMenu
                  senderId={targetMessage.sender.id}
                  senderEmail={targetMessage.sender.email}
                  defaultPattern={stripReplyPrefixes(
                    targetMessage.subject || "",
                  )}
                />
                <ScreenDomainMenu
                  senderId={targetMessage.sender.id}
                  domain={targetMessage.sender.email.split("@")[1]}
                />
              </>
            )}
            <UnthreadToggle
              senderId={targetMessage.sender.id}
              senderLabel={
                targetMessage.sender.displayName || targetMessage.sender.email
              }
              unthread={targetMessage.sender.unthread}
            />
          </>
        )}
        <div
          className={cn(
            "shrink-0 items-center gap-1",
            hideHeaderActionsOnMobile ? "hidden md:flex" : "flex",
          )}
        >
          {actions({
            messageId,
            returnPath,
            threadKey,
            threadId,
            timezone: userInfo.timezone,
            followUpAt: targetMessage.followUpAt,
            isFollowUp: targetMessage.isFollowUp,
            isReplyLater: targetMessage.isReplyLater,
          })}
        </div>
      </div>

      {/* The layout's persistent person pane shows the counterpart
          (kurir-ios#115); no contact column of our own. */}
      <PersonPaneTarget email={contactEmail} />
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto pb-16 md:pb-0" data-thread-scroll>
          <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-8">
            <h1 className="font-serif text-2xl font-semibold text-foreground md:text-display">
              {subject}
            </h1>
            {splitOrigin && (
              <Link
                href={splitOrigin.href}
                data-split-origin
                className="eyebrow mt-2 inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Split className="h-3 w-3" />
                Split from your message {formatDate(splitOrigin.sentAt)}
              </Link>
            )}

            <div className="mt-3 md:mt-6">
              <ThreadPageContent
                userId={session.user.id}
                initialMessages={messages.map((message) => ({
                  ...message,
                  meeting: serializeMessageMeeting(message.meeting),
                }))}
                currentUserEmail={currentUserEmail}
                userEmails={[...userEmails]}
                replyOptions={replyOptions}
                initialReplyTargetId={initialReplyTargetId}
                draftContextIds={draftContextIds}
                branches={branches}
                emailConnectionId={targetMessage.emailConnectionId}
                userTimezone={userInfo.timezone}
                remoteImagePolicy={userInfo.remoteImagePolicy}
                recipientNames={recipientNames}
                hasWritableCalendar={userInfo.hasWritableCalendar}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom action bar */}
      {mobileActions && (
        <MobileThreadActions
          messageId={messageId}
          returnPath={returnPath}
          timezone={userInfo.timezone}
          threadKey={threadKey}
          threadId={threadId}
          showArchive={mobileActions.showArchive}
          showSnooze={mobileActions.showSnooze}
          showFollowUp={mobileActions.showFollowUp}
        />
      )}
    </div>
  );
}
