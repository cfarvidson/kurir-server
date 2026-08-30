import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { PushNotificationBanner } from "@/components/mail/push-notification-banner";
import { SearchResults } from "@/components/mail/search-results";
import { EmptyState } from "@/components/mail/empty-state";
import { Inbox } from "lucide-react";
import { getMessages } from "@/lib/mail/messages";
import {
  emptyCopy,
  searchActionProps,
  searchCategoryFilter,
  searchCategoryForScope,
} from "@/lib/mail/list-contract";

export default async function ImboxPage({
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
        title="Imbox"
        actions={<SearchInput list="imbox" />}
      />

      {/* Push notification discovery banner */}
      <PushNotificationBanner />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={searchCategoryFilter(
              searchCategoryForScope("imbox", scope),
            )}
            basePath="/imbox"
            list="imbox"
            emptyIcon={<Inbox />}
            {...searchActionProps("imbox")}
          />
        ) : (
          <PaginatedImbox userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedImbox({ userId }: { userId: string }) {
  const result = await getMessages(userId, "imbox", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="imbox" {...emptyCopy("imbox")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="imbox"
      basePath="/imbox"
      showSections={true}
      showArchiveAction={true}
      showSnoozeAction={true}
      showFollowUpAction={true}
      showSelectionToggle={true}
    />
  );
}
