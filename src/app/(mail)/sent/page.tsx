import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Send } from "lucide-react";
import { MessageList } from "@/components/mail/message-list";
import { EmptyState } from "@/components/mail/empty-state";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";
import {
  searchActionProps,
  searchCategoryFilter,
} from "@/lib/mail/list-contract";

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
  const messages = await db.message.findMany({
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
          unthread: true,
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

/**
 * Look up display names for recipient email addresses from the Sender table.
 */
async function getRecipientNames(
  userId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const senders = await db.sender.findMany({
    where: { userId, email: { in: unique } },
    select: { email: true, displayName: true },
  });

  const map = new Map<string, string>();
  for (const s of senders) {
    if (s.displayName) {
      map.set(s.email, s.displayName);
    }
  }
  return map;
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

  const { q } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  if (isSearching) {
    return (
      <div className="flex h-full flex-col">
        <PageMasthead
          eyebrow="Outbound"
          title="Sent"
          actions={<SearchInput />}
        />
        <div className="flex-1 overflow-auto">
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={searchCategoryFilter("sent")}
            basePath="/sent"
            emptyIcon={<Send />}
            {...searchActionProps("sent")}
          />
        </div>
      </div>
    );
  }

  const sentFolder = await getSentFolder(session.user.id);

  if (!sentFolder) {
    return (
      <div className="flex h-full flex-col">
        <PageMasthead eyebrow="Outbound" title="Sent" />
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={<Send />}
            title="No sent folder found"
            description="Sync your mailbox to see sent messages."
          />
        </div>
      </div>
    );
  }

  const rawMessages = await getSentMessages(session.user.id, sentFolder.id);

  // For sent messages, show recipient instead of sender
  const recipientEmails = rawMessages
    .map((m) => m.toAddresses?.[0])
    .filter(Boolean) as string[];
  const recipientNames = await getRecipientNames(
    session.user.id,
    recipientEmails,
  );

  const messages = rawMessages.map((m) => {
    const recipientEmail = m.toAddresses?.[0];
    if (!recipientEmail) return m;

    return {
      ...m,
      fromName: recipientNames.get(recipientEmail) || recipientEmail,
      fromAddress: recipientEmail,
      sender: null,
    };
  });

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Outbound"
        title="Sent"
        actions={<SearchInput />}
      />

      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title="No sent messages"
            description="Messages you send will appear here."
          />
        ) : (
          <MessageList
            messages={messages}
            basePath="/sent"
            showFollowUpAction
          />
        )}
      </div>
    </div>
  );
}
