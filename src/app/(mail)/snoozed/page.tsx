import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { InfiniteMessageList } from "@/components/mail/infinite-message-list";
import { SearchInput } from "@/components/mail/search-input";
import { SearchResults } from "@/components/mail/search-results";
import { getMessages } from "@/lib/mail/messages";
import { Clock } from "lucide-react";

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
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Snoozed</h1>
        <SearchInput />
      </div>

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
            emptyIcon={
              <div className="rounded-full bg-muted p-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
              </div>
            }
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
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="rounded-full bg-muted p-4">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-medium">No snoozed conversations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Snoozed conversations will appear here until they wake up.
        </p>
      </div>
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
