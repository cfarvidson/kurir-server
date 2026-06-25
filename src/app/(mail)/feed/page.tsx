import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { SearchResults } from "@/components/mail/search-results";
import { EmptyState } from "@/components/mail/empty-state";
import { Newspaper } from "lucide-react";
import { getMessages } from "@/lib/mail/messages";

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
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-title">The Feed</h1>
        <SearchInput />
      </div>

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={Prisma.sql`AND "isInFeed" = true AND "isSnoozed" = false`}
            basePath="/feed"
            showArchiveAction
            showSnoozeAction
            emptyIcon={<Newspaper />}
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
    return (
      <EmptyState
        icon={<Newspaper />}
        title="No newsletters yet"
        description="Screen in newsletter senders and send them to The Feed."
      />
    );
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
