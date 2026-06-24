import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { SearchInput } from "@/components/mail/search-input";
import { FilesList } from "@/components/mail/files-list";
import { FileTypeFilter } from "@/components/mail/file-type-filter";
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
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-title">Files</h1>
        <SearchInput />
      </div>

      {/* Filter tabs */}
      <div className="border-b px-4 py-2 md:px-6">
        <FileTypeFilter active={group} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <Paperclip className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-medium">No files</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query || group
                ? "No attachments match your filters."
                : "Attachments from your mail will appear here."}
            </p>
          </div>
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
