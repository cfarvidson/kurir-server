import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { ArchiveButton } from "@/components/mail/archive-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function SentDetailPage({
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
      categoryLabel="Sent"
      returnPath="/sent"
      searchQuery={q}
      isSentView
      mobileActions={{ showArchive: true, showFollowUp: true }}
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
