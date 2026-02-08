import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScreenerView } from "@/components/screener/screener-view";
import { ScreenedSenderList } from "@/components/screener/screened-sender-list";

async function getPendingSenders(userId: string) {
  return db.sender.findMany({
    where: {
      userId,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: {
          id: true,
          subject: true,
          snippet: true,
          receivedAt: true,
        },
      },
      _count: {
        select: { messages: true },
      },
    },
  });
}

async function getScreenedSenders(userId: string) {
  return db.sender.findMany({
    where: {
      userId,
      status: { in: ["APPROVED", "REJECTED"] },
    },
    orderBy: { decidedAt: "desc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      domain: true,
      status: true,
      category: true,
      decidedAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export default async function ScreenerPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [pendingSenders, screenedSenders] = await Promise.all([
    getPendingSenders(session.user.id),
    getScreenedSenders(session.user.id),
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Screener</h1>
        {pendingSenders.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {pendingSenders.length} awaiting
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {pendingSenders.length === 0 && screenedSenders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-green-100 p-4">
              <svg
                className="h-8 w-8 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-medium">No senders yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sync your email to start screening senders.
            </p>
          </div>
        ) : (
          <>
            {pendingSenders.length > 0 && (
              <ScreenerView senders={pendingSenders} />
            )}
            {screenedSenders.length > 0 && (
              <ScreenedSenderList senders={screenedSenders} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
