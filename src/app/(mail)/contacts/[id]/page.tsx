import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, PenSquare, Inbox, Newspaper, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactThreadList } from "@/components/contacts/contact-thread-list";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";

const categoryConfig = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary bg-primary/10" },
  FEED: { label: "Feed", icon: Newspaper, color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30" },
  PAPER_TRAIL: { label: "Paper Trail", icon: Receipt, color: "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30" },
} as const;

async function getContact(userId: string, contactId: string) {
  return db.sender.findFirst({
    where: { id: contactId, userId, status: "APPROVED" },
  });
}

async function getConversations(userId: string, email: string) {
  const messages = await db.message.findMany({
    where: {
      userId,
      OR: [
        { fromAddress: email },
        { toAddresses: { has: email } },
      ],
    },
    include: {
      sender: { select: { displayName: true, email: true } },
      attachments: { select: { id: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  const collapsed = collapseToThreads(messages);
  const threadCounts = await getThreadCounts(userId, collapsed);

  return collapsed.map((msg) => ({
    ...msg,
    threadCount: threadCounts.get(msg.id) ?? 1,
    hasAttachments: msg.attachments.length > 0,
  }));
}

function getInitialColor(str: string): string {
  const palettes = [
    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
    "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palettes[Math.abs(hash) % palettes.length];
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const contact = await getContact(session.user.id, id);

  if (!contact) {
    notFound();
  }

  const conversations = await getConversations(session.user.id, contact.email);
  const name = contact.displayName || contact.email.split("@")[0];
  const cat = categoryConfig[contact.category];
  const CatIcon = cat.icon;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-4 md:px-6">
        <Link
          href="/contacts"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Contacts
        </Link>
      </div>

      {/* Contact profile */}
      <div className="border-b px-4 py-5 md:px-6 md:py-6">
        <div className="flex items-start gap-4 md:gap-5">
          {/* Large avatar */}
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold md:h-16 md:w-16 md:text-xl ${getInitialColor(contact.email)}`}
          >
            {name.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight md:text-xl">{name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{contact.email}</p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* Category badge */}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cat.color}`}>
                <CatIcon className="h-3 w-3" />
                {cat.label}
              </span>

              {/* Message count */}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" />
                {contact.messageCount} message{contact.messageCount !== 1 ? "s" : ""}
              </span>

              {/* Domain */}
              <span className="text-xs text-muted-foreground/60">
                {contact.domain}
              </span>
            </div>
          </div>

          {/* Compose button */}
          <Button asChild size="sm" className="shrink-0 gap-1.5">
            <Link href={`/compose?to=${encodeURIComponent(contact.email)}`}>
              <PenSquare className="h-3.5 w-3.5" />
              Compose
            </Link>
          </Button>
        </div>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-medium">No conversations yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Messages with {name} will appear here.
            </p>
          </div>
        ) : (
          <ContactThreadList conversations={conversations} contactName={name} />
        )}
      </div>
    </div>
  );
}
