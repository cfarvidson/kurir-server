import { ThreadDetailView } from "@/components/mail/thread-detail-view";
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
      actions={({ messageId, returnPath, followUpAt, isFollowUp }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
          />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
          />
          <ArchiveButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
