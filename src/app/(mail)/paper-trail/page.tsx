import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { MessageList } from "@/components/mail/message-list";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { searchMessages } from "@/lib/mail/search";
import { getMessages } from "@/lib/mail/messages";

export default async function PaperTrailPage({
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
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Paper Trail</h1>
        <SearchInput />
      </div>

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults userId={session.user.id} q={q!} />
        ) : (
          <PaginatedPaperTrail userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function SearchResults({ userId, q }: { userId: string; q: string }) {
  const messages = await searchMessages(
    userId,
    q,
    Prisma.sql`AND "isInPaperTrail" = true`
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-amber-100 p-4">
          <svg
            className="h-8 w-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-medium">No results found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No messages match &quot;{q}&quot;
        </p>
      </div>
    );
  }

  return (
    <MessageList showArchiveAction showSnoozeAction messages={messages} basePath="/paper-trail" />
  );
}

async function PaginatedPaperTrail({ userId }: { userId: string }) {
  const result = await getMessages(userId, "paper-trail", 50);

  if (!result || result.messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-amber-100 p-4">
          <svg
            className="h-8 w-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-medium">No receipts yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Screen in transactional senders and send them to Paper Trail.
        </p>
      </div>
    );
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
    />
  );
}
