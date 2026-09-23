import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { ArchiveButton } from "@/components/mail/archive-button";
import { SnoozeButton } from "@/components/mail/snooze-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function FeedDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;

  return (
    <ThreadDetailView
      messageId={id}
      categoryLabel="The Feed"
      returnPath="/feed"
      searchQuery={q}
      mobileActions={{ showArchive: true, showSnooze: true, showFollowUp: true }}
      hideHeaderActionsOnMobile
      actions={({
        messageId,
        returnPath,
        threadKey,
        threadId,
        timezone,
        followUpAt,
        isFollowUp,
        isReplyLater,
        isPinned,
      }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
            threadKey={threadKey}
            threadId={threadId}
          />
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
            timezone={timezone}
          />
          <SnoozeButton
            messageId={messageId}
            returnPath={returnPath}
            timezone={timezone}
          />
          <ArchiveButton
            messageId={messageId}
            returnPath={returnPath}
            threadKey={threadKey}
            threadId={threadId}
          />
        </>
      )}
    />
  );
}
