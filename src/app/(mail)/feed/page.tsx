import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { EmptyState } from "@/components/mail/empty-state";
import { Newspaper } from "lucide-react";
import { getMessages } from "@/lib/mail/messages";
import {
  emptyCopy,
  searchActionProps,
  searchCategoryFilter,
} from "@/lib/mail/list-contract";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { q } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="The Feed"
        title="Feed"
        actions={<SearchInput />}
      />

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={searchCategoryFilter("feed")}
            basePath="/feed"
            list="feed"
            emptyIcon={<Newspaper />}
            {...searchActionProps("feed")}
          />
        ) : (
          <PaginatedFeed userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedFeed({ userId }: { userId: string }) {
  const result = await getMessages(userId, "feed", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState icon={<Newspaper />} {...emptyCopy("feed")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="feed"
      basePath="/feed"
      showSections={true}
      showArchiveAction={true}
      showSnoozeAction={true}
      showFollowUpAction={true}
      showSelectionToggle={true}
    />
  );
}
