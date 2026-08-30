import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { EmptyState } from "@/components/mail/empty-state";
import { Archive } from "lucide-react";
import {
  emptyCopy,
  searchActionProps,
  searchCategoryFilter,
  searchCategoryForScope,
} from "@/lib/mail/list-contract";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { q, scope } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Mailbox"
        title="Archive"
        actions={<SearchInput list="archive" />}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={searchCategoryFilter(
              searchCategoryForScope("archive", scope),
            )}
            basePath="/archive"
            list="archive"
            emptyIcon={<Archive />}
            {...searchActionProps("archive")}
          />
        ) : (
          <PaginatedArchive userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedArchive({ userId }: { userId: string }) {
  const result = await getMessages(userId, "archive", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="icon" {...emptyCopy("archive")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="archive"
      basePath="/archive"
      showUnarchiveAction
      showFollowUpAction
      showSelectionToggle
    />
  );
}
