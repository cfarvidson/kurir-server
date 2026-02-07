import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MessageList } from "@/components/mail/message-list";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";

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

export default async function ImboxPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const messages = await getImboxMessages(session.user.id);

  // Split into New For You (unread) and Previously Seen (read)
  const newMessages = messages.filter((m) => !m.isRead);
  const seenMessages = messages.filter((m) => m.isRead);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-6">
        <h1 className="text-2xl font-semibold">Imbox</h1>
        <div className="text-sm text-muted-foreground">
          {newMessages.length} new
        </div>
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
            <h2 className="mt-4 text-lg font-medium">Your Imbox is empty</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve senders in the Screener to see their emails here.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {/* New For You Section */}
            {newMessages.length > 0 && (
              <section>
                <div className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <h2 className="px-6 py-3 text-sm font-medium text-muted-foreground">
                    New For You
                  </h2>
                </div>
                <MessageList messages={newMessages} />
              </section>
            )}

            {/* Previously Seen Section */}
            {seenMessages.length > 0 && (
              <section>
                <div className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <h2 className="px-6 py-3 text-sm font-medium text-muted-foreground">
                    Previously Seen
                  </h2>
                </div>
                <MessageList messages={seenMessages} />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
