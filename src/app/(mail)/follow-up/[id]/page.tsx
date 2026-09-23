import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { DismissFollowUpButton } from "@/components/mail/dismiss-follow-up-button";
import { ExtendFollowUpButton } from "@/components/mail/extend-follow-up-button";

export default async function FollowUpDetailPage({
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
      categoryLabel="Follow Up"
      returnPath="/follow-up"
      searchQuery={q}
      mobileActions={{ showFollowUp: true }}
      actions={({ messageId, returnPath, timezone, isReplyLater, isPinned }) => (
        <>
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <DismissFollowUpButton
            messageId={messageId}
            returnPath={returnPath}
          />
          <ExtendFollowUpButton
            messageId={messageId}
            returnPath={returnPath}
            timezone={timezone}
          />
        </>
      )}
    />
  );
}
