import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { ArchiveButton } from "@/components/mail/archive-button";
import { SnoozeButton } from "@/components/mail/snooze-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function ImboxDetailPage({
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
      categoryLabel="Imbox"
      returnPath="/imbox"
      searchQuery={q}
      mobileActions={{ showArchive: true, showSnooze: true, showFollowUp: true }}
      hideHeaderActionsOnMobile
      actions={({
        messageId,
        returnPath,
        timezone,
        followUpAt,
        isFollowUp,
        isReplyLater,
      }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
          />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
          />
          <SnoozeButton
            messageId={messageId}
            returnPath={returnPath}
            timezone={timezone}
          />
          <ArchiveButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
