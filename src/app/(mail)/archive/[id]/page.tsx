import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { UnarchiveButton } from "@/components/mail/unarchive-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function ArchiveDetailPage({
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
      categoryLabel="Archive"
      returnPath="/archive"
      searchQuery={q}
      mobileActions={{ showFollowUp: true }}
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
            action="unarchive"
          />
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
            timezone={timezone}
          />
          <UnarchiveButton
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
