import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MessageList } from "@/components/mail/message-list";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";

async function getFeedMessages(userId: string) {
  const messages = await db.message.findMany({
    where: {
      userId,
      isInFeed: true,
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

export default async function FeedPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const messages = await getFeedMessages(session.user.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">The Feed</h1>
        <div className="text-sm text-muted-foreground">
          {messages.length} newsletters
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
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
        ) : (
          <MessageList messages={messages} />
        )}
      </div>
    </div>
  );
}
