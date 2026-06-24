import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PushNotificationBanner } from "@/components/mail/push-notification-banner";
import { SearchResults } from "@/components/mail/search-results";
import { EmptyState } from "@/components/mail/empty-state";
import { Inbox } from "lucide-react";
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
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Imbox</h1>
        <SearchInput />
      </div>

      {/* Push notification discovery banner */}
      <PushNotificationBanner />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={Prisma.sql`AND "isInImbox" = true AND "isSnoozed" = false`}
            basePath="/imbox"
            showArchiveAction
            showSnoozeAction
            emptyIcon={<Inbox />}
          />
        ) : (
          <PaginatedImbox userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedImbox({ userId }: { userId: string }) {
  const result = await getMessages(userId, "imbox", 50);

  if (!result || result.messages.length === 0) {
    return (
      <EmptyState
        icon={<Inbox />}
        title="Your Imbox is empty"
        description="Approve senders in the Screener to see their emails here."
      />
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
      showSnoozeAction={true}
      showFollowUpAction={true}
      showSelectionToggle={true}
    />
  );
}
