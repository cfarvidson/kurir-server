import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScreenerView } from "@/components/screener/screener-view";

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

export default async function ScreenerPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const senders = await getPendingSenders(session.user.id);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-6">
        <h1 className="text-2xl font-semibold">Screener</h1>
        <div className="text-sm text-muted-foreground">
          {senders.length} awaiting
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {senders.length === 0 ? (
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
            <h2 className="mt-4 text-lg font-medium">All caught up!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No new senders are waiting for your decision.
            </p>
          </div>
        ) : (
          <ScreenerView senders={senders} />
        )}
      </div>
    </div>
  );
}
