import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { EmptyState } from "@/components/mail/empty-state";
import { Receipt } from "lucide-react";
import { getMessages } from "@/lib/mail/messages";
import {
  emptyCopy,
  searchActionProps,
  type MailSearchQuery,
} from "@/lib/mail/list-contract";
import { searchFilterSql } from "@/lib/mail/search";

export default async function PaperTrailPage({
  searchParams,
}: {
  searchParams: Promise<MailSearchQuery>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const isSearching = !!(params.q && params.q.length >= 2);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Records"
        title="Paper Trail"
        actions={<SearchInput list="paper-trail" />}
      />

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={params.q!}
            categoryFilter={searchFilterSql("paper-trail", params)}
            basePath="/paper-trail"
            list="paper-trail"
            emptyIcon={<Receipt />}
            {...searchActionProps("paper-trail")}
          />
        ) : (
          <PaginatedPaperTrail userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedPaperTrail({ userId }: { userId: string }) {
  const result = await getMessages(userId, "paper-trail", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="paper-trail" {...emptyCopy("paper-trail")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="paper-trail"
      basePath="/paper-trail"
      showSections={true}
      showArchiveAction={true}
      showSnoozeAction={true}
      showFollowUpAction={true}
      showSelectionToggle={true}
    />
  );
}
