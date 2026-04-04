import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { SearchResults } from "@/components/mail/search-results";
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
        <h1 className="text-xl font-semibold md:text-2xl">The Feed</h1>
        <SearchInput />
      </div>

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={Prisma.sql`AND "isInFeed" = true`}
            basePath="/feed"
            showArchiveAction
            showSnoozeAction
            emptyIcon={
              <div className="rounded-full bg-blue-100 p-4">
                <svg
                  className="h-8 w-8 text-blue-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                  />
                </svg>
              </div>
            }
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
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-blue-100 p-4">
          <svg
            className="h-8 w-8 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-medium">No newsletters yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Screen in newsletter senders and send them to The Feed.
        </p>
      </div>
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
