import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { ArchiveButton } from "@/components/mail/archive-button";
import { UnarchiveButton } from "@/components/mail/unarchive-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function PinnedDetailPage({
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
      categoryLabel="Pinned"
      returnPath="/pinned"
      searchQuery={q}
      mobileActions={{ showFollowUp: true, showPin: true }}
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
        isArchived,
      }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
            threadKey={threadKey}
            threadId={threadId}
            action={isArchived ? "unarchive" : "archive"}
          />
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
            timezone={timezone}
          />
          {isArchived ? (
            <UnarchiveButton
              messageId={messageId}
              returnPath={returnPath}
              threadKey={threadKey}
              threadId={threadId}
            />
          ) : (
            <ArchiveButton
              messageId={messageId}
              returnPath={returnPath}
              threadKey={threadKey}
              threadId={threadId}
            />
          )}
        </>
      )}
    />
  );
}
