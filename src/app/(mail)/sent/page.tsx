import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MessageList } from "@/components/mail/message-list";

async function getSentMessages(userId: string) {
  // Get sent folder
  const sentFolder = await db.folder.findFirst({
    where: {
      userId,
      OR: [
        { specialUse: "sent" },
        { path: { contains: "sent", mode: "insensitive" } },
      ],
    },
  });

  if (!sentFolder) {
    return [];
  }

  return db.message.findMany({
    where: {
      userId,
      folderId: sentFolder.id,
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

export default async function SentPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const messages = await getSentMessages(session.user.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Sent</h1>
        <div className="text-sm text-muted-foreground">
          {messages.length} messages
        </div>
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
            <h2 className="mt-4 text-lg font-medium">No sent messages</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Messages you send will appear here.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>
    </div>
  );
}
