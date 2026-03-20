import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScreenerView } from "@/components/screener/screener-view";
import { ScreenerHintBanner } from "@/components/screener/screener-hint-banner";
import { ScreenedSenderList } from "@/components/screener/screened-sender-list";
import { SkippedSenderList } from "@/components/screener/skipped-sender-list";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";

async function getPendingSenders(userId: string, excludedEmails?: string[]) {
  return db.sender.findMany({
    where: visiblePendingSenderWhere(userId, excludedEmails),
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

async function getSkippedSenders(userId: string, excludedEmails?: string[]) {
  return db.sender.findMany({
    where: {
      userId,
      status: "PENDING",
      skippedUntil: { gt: new Date() },
      ...(excludedEmails?.length
        ? { NOT: { email: { in: excludedEmails } } }
        : {}),
      messages: {
        some: { isArchived: false },
      },
    },
    orderBy: { skippedUntil: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      domain: true,
      skippedUntil: true,
      _count: { select: { messages: true } },
    },
  });
}

async function getScreenedSenders(userId: string, excludedEmails?: string[]) {
  return db.sender.findMany({
    where: {
      userId,
      status: { in: ["APPROVED", "REJECTED"] },
      ...(excludedEmails?.length
        ? { NOT: { email: { in: excludedEmails } } }
        : {}),
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

  const connections = await db.emailConnection.findMany({
    where: { userId: session.user.id },
    select: { email: true, sendAsEmail: true, aliases: true },
  });
  const userEmails = [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];

  const [pendingSenders, skippedSenders, screenedSenders] = await Promise.all([
    getPendingSenders(session.user.id, userEmails),
    getSkippedSenders(session.user.id, userEmails),
    getScreenedSenders(session.user.id, userEmails),
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

      {/* Keyboard hint banner (desktop only, first visit) */}
      {pendingSenders.length > 0 && <ScreenerHintBanner />}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {pendingSenders.length === 0 && skippedSenders.length === 0 && screenedSenders.length === 0 ? (
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
            {skippedSenders.length > 0 && (
              <SkippedSenderList senders={skippedSenders} />
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
