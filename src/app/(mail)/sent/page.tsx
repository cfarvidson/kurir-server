import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { MessageList } from "@/components/mail/message-list";
import { SearchInput } from "@/components/mail/search-input";
import { searchMessages } from "@/lib/mail/search";

async function getSentFolder(userId: string) {
  return db.folder.findFirst({
    where: {
      userId,
      OR: [
        { specialUse: "sent" },
        { path: { contains: "sent", mode: "insensitive" } },
      ],
    },
  });
}

async function getSentMessages(userId: string, folderId: string) {
  return db.message.findMany({
    where: {
      userId,
      folderId,
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
}

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const sentFolder = await getSentFolder(session.user.id);

  if (!sentFolder) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
          <h1 className="text-xl font-semibold md:text-2xl">Sent</h1>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h2 className="text-lg font-medium">No sent folder found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sync your mailbox to see sent messages.
          </p>
        </div>
      </div>
    );
  }

  const { q } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  const messages = isSearching
    ? await searchMessages(
        session.user.id,
        q,
        Prisma.sql`AND "folderId" = ${sentFolder.id}`
      )
    : await getSentMessages(session.user.id, sentFolder.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Sent</h1>
        <SearchInput />
      </div>

      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <svg
                className="h-8 w-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-medium">
              {isSearching ? "No results found" : "No sent messages"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSearching
                ? `No messages match "${q}"`
                : "Messages you send will appear here."}
            </p>
          </div>
        ) : (
          <MessageList messages={messages} basePath="/sent" />
        )}
      </div>
    </div>
  );
}
