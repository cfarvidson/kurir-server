import { ThreadDetailView } from "@/components/mail/thread-detail-view";
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
      actions={({ messageId, returnPath }) => (
        <ClearReplyLaterButton messageId={messageId} returnPath={returnPath} />
      )}
    />
  );
}
