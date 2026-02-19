import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { MessageList } from "@/components/mail/message-list";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { searchMessages } from "@/lib/mail/search";
import { getMessages } from "@/lib/mail/messages";

export default async function ImboxPage({
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
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Imbox</h1>
        <SearchInput />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults userId={session.user.id} q={q!} />
        ) : (
          <PaginatedImbox userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function SearchResults({ userId, q }: { userId: string; q: string }) {
  const messages = await searchMessages(
    userId,
    q,
    Prisma.sql`AND "isInImbox" = true`
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
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

  return <MessageList showArchiveAction messages={messages} basePath="/imbox" />;
}

async function PaginatedImbox({ userId }: { userId: string }) {
  const result = await getMessages(userId, "imbox", 50);

  if (!result || result.messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-medium">Your Imbox is empty</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve senders in the Screener to see their emails here.
        </p>
      </div>
    );
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="imbox"
      basePath="/imbox"
      showSections={true}
      showArchiveAction={true}
      showSelectionToggle={true}
    />
  );
}
