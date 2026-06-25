import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { EmptyState } from "@/components/mail/empty-state";
import { Bell } from "lucide-react";

export default async function FollowUpPage({
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
      <PageMasthead
        eyebrow="Triage"
        title="Follow Up"
        actions={<SearchInput />}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <SearchResults
            userId={session.user.id}
            query={q!}
            categoryFilter={Prisma.sql`AND "isFollowUp" = true AND "isArchived" = false`}
            basePath="/follow-up"
            emptyIcon={<Bell />}
          />
        ) : (
          <PaginatedFollowUp userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function PaginatedFollowUp({ userId }: { userId: string }) {
  const result = await getMessages(userId, "follow-up", 50);

  if (!result || result.messages.length === 0) {
    return (
      <EmptyState
        icon={<Bell />}
        title="No follow-ups"
        description="Threads you're waiting on will appear here when the deadline passes."
      />
    );
  }

  return (
    <InfiniteMessageList
      initialMessages={result.messages}
      initialCursor={result.nextCursor}
      category="follow-up"
      basePath="/follow-up"
      showSelectionToggle
      showArchiveAction
      showFollowUpAction
    />
  );
}
