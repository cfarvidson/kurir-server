import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { MessageList } from "@/components/mail/message-list";
import { SearchInput } from "@/components/mail/search-input";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";
import { searchMessages } from "@/lib/mail/search";
import { Archive } from "lucide-react";

async function getArchivedMessages(userId: string) {
  const messages = await db.message.findMany({
    where: {
      userId,
      isArchived: true,
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

export default async function ArchivePage({
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
        Prisma.sql`AND "isArchived" = true`
      )
    : await getArchivedMessages(session.user.id);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Archive</h1>
        <SearchInput />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <Archive className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-medium">
              {isSearching ? "No results found" : "Archive is empty"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSearching
                ? `No messages match "${q}"`
                : "Archived conversations will appear here."}
            </p>
          </div>
        ) : (
          <MessageList messages={messages} basePath="/archive" />
        )}
      </div>
    </div>
  );
}
