import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { EmptyState } from "@/components/mail/empty-state";
import { Pin } from "lucide-react";
import {
  emptyCopy,
  searchActionProps,
  type MailSearchQuery,
  isSearchQuery,
} from "@/lib/mail/list-contract";
import {
  hasSearchConstraints,
  searchFilterSql,
} from "@/lib/mail/search";

/**
 * Pinned threads (plan 056): every thread with the IMAP \Flagged flag,
 * wherever it lives. Rows keep the pin toggle; there is no list-wide
 * archive action because archived and live threads mix here.
 */
export default async function PinnedPage({
  searchParams,
}: {
  searchParams: Promise<MailSearchQuery>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const constrained = hasSearchConstraints(params);
  const isSearching = isSearchQuery(params.q) || constrained;

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Later"
        title="Pinned"
        actions={<SearchInput list="pinned" />}
      />

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={params.q ?? ""}
            constrained={constrained}
            categoryFilter={searchFilterSql("pinned", params)}
            basePath="/pinned"
            list="pinned"
            emptyIcon={<Pin />}
            {...searchActionProps("pinned")}
          />
        ) : (
          <PaginatedPinned userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedPinned({ userId }: { userId: string }) {
  const result = await getMessages(userId, "pinned", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="icon" {...emptyCopy("pinned")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="pinned"
      basePath="/pinned"
      showFollowUpAction
      showSelectionToggle
    />
  );
}
