import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { ArchiveButton } from "@/components/mail/archive-button";
import { SnoozeButton } from "@/components/mail/snooze-button";
import { FollowUpButton } from "@/components/mail/follow-up-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";

export default async function PaperTrailDetailPage({
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
      categoryLabel="Paper Trail"
      returnPath="/paper-trail"
      searchQuery={q}
      actions={({ messageId, returnPath, timezone, followUpAt, isFollowUp }) => (
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
