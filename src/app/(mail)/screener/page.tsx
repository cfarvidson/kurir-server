import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScreenerContent } from "@/components/screener/screener-content";
import { PageMasthead } from "@/components/layout/page-masthead";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { getOwnAddresses, type OwnAddresses } from "@/lib/mail/user-emails";
import { listDomainRulesForUser } from "@/lib/mail/mutations";

async function getPendingSenders(userId: string, own?: OwnAddresses | null) {
  return db.sender.findMany({
    where: visiblePendingSenderWhere(userId, own),
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

async function getSkippedSenders(userId: string, ownEmails?: string[]) {
  return db.sender.findMany({
    where: {
      userId,
      status: "PENDING",
      skippedUntil: { gt: new Date() },
      ...(ownEmails?.length ? { NOT: { email: { in: ownEmails } } } : {}),
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

async function getScreenedSenders(userId: string, ownEmails?: string[]) {
  return db.sender.findMany({
    where: {
      userId,
      status: { in: ["APPROVED", "REJECTED"] },
      ...(ownEmails?.length ? { NOT: { email: { in: ownEmails } } } : {}),
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

  const own = await getOwnAddresses(session.user.id);

  const [pendingSenders, skippedSenders, screenedSenders, domainRules] =
    await Promise.all([
      getPendingSenders(session.user.id, own),
      getSkippedSenders(session.user.id, own.emails),
      getScreenedSenders(session.user.id, own.emails),
      listDomainRulesForUser(session.user.id),
    ]);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Triage"
        title="The Screener"
        meta={
          pendingSenders.length > 0
            ? `${pendingSenders.length} awaiting`
            : undefined
        }
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <ScreenerContent
          pendingSenders={pendingSenders}
          skippedSenders={skippedSenders}
          screenedSenders={screenedSenders}
          domainRules={domainRules}
        />
      </div>
    </div>
  );
}
