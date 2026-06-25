import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { EmptyState } from "@/components/mail/empty-state";
import { AlarmClock } from "lucide-react";

export default async function SnoozedPage({
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
      <PageMasthead eyebrow="Later" title="Snoozed" actions={<SearchInput />} />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={Prisma.sql`AND "isSnoozed" = true`}
            basePath="/snoozed"
            showSnoozeAction
            showSnoozedUntil
            emptyIcon={<AlarmClock />}
          />
        ) : (
          <PaginatedSnoozed userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedSnoozed({ userId }: { userId: string }) {
  const result = await getMessages(userId, "snoozed", 50);

  if (!result || result.messages.length === 0) {
    return (
      <EmptyState
        icon={<AlarmClock />}
        title="No snoozed conversations"
        description="Snoozed conversations will appear here until they wake up."
      />
    );
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="snoozed"
      basePath="/snoozed"
      showSnoozeAction
      showSnoozedUntil
      showFollowUpAction
      showSelectionToggle
      showArchiveAction={true}
    />
  );
}
