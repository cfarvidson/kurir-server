import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ReplyLaterButton } from "@/components/mail/reply-later-button";
import { UnsnoozeButton } from "@/components/mail/unsnooze-button";

export default async function SnoozedDetailPage({
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
      categoryLabel="Snoozed"
      returnPath="/snoozed"
      searchQuery={q}
      mobileActions={{
        showArchive: false,
        showSnooze: false,
        showFollowUp: false,
      }}
      actions={({ messageId, returnPath, isReplyLater, isPinned }) => (
        <>
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ReplyLaterButton messageId={messageId} isReplyLater={isReplyLater} />
          <UnsnoozeButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
