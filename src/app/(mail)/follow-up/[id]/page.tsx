import { ThreadDetailView } from "@/components/mail/thread-detail-view";
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
      actions={({ messageId, returnPath }) => (
        <>
          <DismissFollowUpButton
            messageId={messageId}
            returnPath={returnPath}
          />
          <ExtendFollowUpButton
            messageId={messageId}
            returnPath={returnPath}
          />
        </>
      )}
    />
  );
}
