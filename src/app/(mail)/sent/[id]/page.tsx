import { ThreadDetailView } from "@/components/mail/thread-detail-view";
import { ArchiveButton } from "@/components/mail/archive-button";
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
      actions={({ messageId, returnPath }) => (
        <>
          <ArchiveKeyboardShortcut
            messageId={messageId}
            returnPath={returnPath}
          />
          <ArchiveButton messageId={messageId} returnPath={returnPath} />
        </>
      )}
    />
  );
}
