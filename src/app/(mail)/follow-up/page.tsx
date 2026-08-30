import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { EmptyState } from "@/components/mail/empty-state";
import { Bell } from "lucide-react";
import {
  emptyCopy,
  searchActionProps,
  type MailSearchQuery,
} from "@/lib/mail/list-contract";
import { searchFilterSql } from "@/lib/mail/search";

export default async function FollowUpPage({
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
        eyebrow="Triage"
        title="Follow Up"
        actions={<SearchInput list="follow-up" />}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={params.q!}
            categoryFilter={searchFilterSql("follow-up", params)}
            basePath="/follow-up"
            list="follow-up"
            emptyIcon={<Bell />}
            {...searchActionProps("follow-up")}
          />
        ) : (
          <PaginatedFollowUp userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedFollowUp({ userId }: { userId: string }) {
  const result = await getMessages(userId, "follow-up", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="follow-up" {...emptyCopy("follow-up")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="follow-up"
      basePath="/follow-up"
      showSelectionToggle
      showArchiveAction
      showFollowUpAction
    />
  );
}
