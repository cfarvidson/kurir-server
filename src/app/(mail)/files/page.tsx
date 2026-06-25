import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { FilesList } from "@/components/mail/files-list";
import { FileTypeFilter } from "@/components/mail/file-type-filter";
import { EmptyState } from "@/components/mail/empty-state";
import { getFiles } from "@/lib/mail/files";
import { parseFileGroup } from "@/lib/mail/file-types";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { q, type } = await searchParams;
  const group = parseFileGroup(type);
  const query = q && q.length >= 2 ? q : null;

  const result = await getFiles(session.user.id, { group, q: query, limit: 50 });
  const files = result?.files ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Attachments"
        title="Files"
        actions={<SearchInput />}
      >
        {/* Filter tabs */}
        <div className="px-4 pb-3 md:px-6">
          <FileTypeFilter active={group} />
        </div>
      </PageMasthead>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <EmptyState
            icon={<Paperclip />}
            title="No files"
            description={
              query || group
                ? "No attachments match your filters."
                : "Attachments from your mail will appear here."
            }
          />
        ) : (
          <FilesList
            initialFiles={files}
            initialCursor={result?.nextCursor ?? null}
            group={group}
            query={query}
          />
        )}
      </div>
    </div>
  );
}
