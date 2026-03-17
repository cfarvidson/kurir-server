import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { UnarchiveButton } from "@/components/mail/unarchive-button";
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
      actions={({ messageId, returnPath }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
            action="unarchive"
          />
          <UnarchiveButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
