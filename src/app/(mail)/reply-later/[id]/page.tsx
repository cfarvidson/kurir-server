import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { PinButton } from "@/components/mail/pin-button";
import { ClearReplyLaterButton } from "@/components/mail/clear-reply-later-button";

export default async function ReplyLaterDetailPage({
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
      categoryLabel="Reply Later"
      returnPath="/reply-later"
      searchQuery={q}
      actions={({ messageId, returnPath, isPinned }) => (
        <>
          <PinButton messageId={messageId} isPinned={isPinned} />
          <ClearReplyLaterButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
