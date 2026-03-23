import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScreenerContent } from "@/components/screener/screener-content";
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

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <ScreenerContent
          pendingSenders={pendingSenders}
          skippedSenders={skippedSenders}
          screenedSenders={screenedSenders}
        />
      </div>
    </div>
  );
}
