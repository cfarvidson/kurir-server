import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Send } from "lucide-react";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { EmptyState } from "@/components/mail/empty-state";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import {
  emptyCopy,
  searchActionProps,
  type MailSearchQuery,
} from "@/lib/mail/list-contract";
import { searchFilterSql } from "@/lib/mail/search";

async function getSentFolder(userId: string) {
  return db.folder.findFirst({
    where: {
      userId,
      OR: [
        { specialUse: "sent" },
        { path: { contains: "sent", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
}

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<MailSearchQuery>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const isSearching = !!(params.q && params.q.length >= 2);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Outbound"
        title="Sent"
        actions={<SearchInput list="sent" />}
      />

      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={params.q!}
            categoryFilter={searchFilterSql("sent", params)}
            basePath="/sent"
            list="sent"
            emptyIcon={<Send />}
            {...searchActionProps("sent")}
          />
        ) : (
          <PaginatedSent userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedSent({ userId }: { userId: string }) {
  const sentFolder = await getSentFolder(userId);

  if (!sentFolder) {
    return (
      <EmptyState
        icon={<Send />}
        title="No sent folder found"
        description="Sync your mailbox to see sent messages."
      />
    );
  }

  const result = await getMessages(userId, "sent", 50);

  if (!result || result.messages.length === 0) {
    return <EmptyState mascot="icon" {...emptyCopy("sent")} />;
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="sent"
      basePath="/sent"
      showFollowUpAction
      showSelectionToggle
    />
  );
}
