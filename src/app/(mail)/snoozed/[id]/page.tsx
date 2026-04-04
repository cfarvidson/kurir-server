import { ThreadDetailView } from "@/components/mail/thread-detail-view";
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
      actions={({ messageId, returnPath }) => (
        <UnsnoozeButton messageId={messageId} returnPath={returnPath} />
      )}
    />
  );
}
