import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { UnarchiveButton } from "@/components/mail/unarchive-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function ArchiveDetailPage({
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
      categoryLabel="Archive"
      returnPath="/archive"
      searchQuery={q}
      actions={({ messageId, returnPath, followUpAt, isFollowUp }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
            action="unarchive"
          />
          <FollowUpButton
            messageId={messageId}
            followUpAt={followUpAt}
            isFollowUp={isFollowUp}
          />
          <UnarchiveButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
