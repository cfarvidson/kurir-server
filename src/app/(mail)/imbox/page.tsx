import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { MessageList } from "@/components/mail/message-list";
import { SearchInput } from "@/components/mail/search-input";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";
import { searchMessages } from "@/lib/mail/search";

async function getImboxMessages(userId: string) {
  const messages = await db.message.findMany({
    where: {
      userId,
      isInImbox: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
    include: {
      sender: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  const threadCounts = await getThreadCounts(userId, messages);

  const withCounts = messages.map((m) => ({
    ...m,
    threadCount: threadCounts.get(m.id) ?? 1,
  }));

  return collapseToThreads(withCounts);
}

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

  const messages = isSearching
    ? await searchMessages(
        session.user.id,
        q,
        Prisma.sql`AND "isInImbox" = true`
      )
    : await getImboxMessages(session.user.id);

  // Split into New For You (unread) and Previously Seen (read) — only when not searching
  const newMessages = isSearching ? [] : messages.filter((m) => !m.isRead);
  const seenMessages = isSearching ? [] : messages.filter((m) => m.isRead);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Imbox</h1>
        <SearchInput />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
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
            <h2 className="mt-4 text-lg font-medium">
              {isSearching ? "No results found" : "Your Imbox is empty"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSearching
                ? `No messages match "${q}"`
                : "Approve senders in the Screener to see their emails here."}
            </p>
          </div>
        ) : isSearching ? (
          <MessageList showArchiveAction messages={messages} />
        ) : (
          <div className="divide-y">
            {/* New For You Section */}
            {newMessages.length > 0 && (
              <section>
                <div className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                    New For You
                  </h2>
                </div>
                <MessageList showArchiveAction messages={newMessages} />
              </section>
            )}

            {/* Previously Seen Section */}
            {seenMessages.length > 0 && (
              <section>
                <div className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                    Previously Seen
                  </h2>
                </div>
                <MessageList showArchiveAction messages={seenMessages} />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
