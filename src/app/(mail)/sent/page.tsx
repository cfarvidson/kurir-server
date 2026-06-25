import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import Link from "next/link";
import {
  BookUser,
  ChevronRight,
  Inbox,
  Newspaper,
  Receipt,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageList } from "@/components/mail/message-list";
import { EmptyState } from "@/components/mail/empty-state";
import { SearchInput } from "@/components/mail/search-input";
import { PageMasthead } from "@/components/layout/page-masthead";
import { searchMessages } from "@/lib/mail/search";
import {
  searchContacts,
  type ContactSearchResult,
} from "@/lib/mail/search-contacts";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";

const categoryConfig = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-imbox" },
  FEED: {
    label: "Feed",
    icon: Newspaper,
    color: "text-feed",
  },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color: "text-paper-trail",
  },
} as const;

function ContactResultRow({ contact }: { contact: ContactSearchResult }) {
  const name = contact.displayName || contact.email.split("@")[0];
  const cat = categoryConfig[contact.category ?? "IMBOX"];
  const CatIcon = cat.icon;

  const content = (
    <>
      <BookUser className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {contact.email}
      </span>
      <CatIcon className={cn("ml-auto h-3.5 w-3.5 shrink-0", cat.color)} />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
    </>
  );

  if (contact.contactId) {
    return (
      <Link
        href={`/contacts/${contact.contactId}`}
        className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground">
      {content}
    </div>
  );
}

async function getSentFolder(userId: string) {
  return db.folder.findFirst({
    where: {
      userId,
      OR: [
        { specialUse: "sent" },
        { path: { contains: "sent", mode: "insensitive" } },
      ],
    },
  });
}

async function getSentMessages(userId: string, folderId: string) {
  const messages = await db.message.findMany({
    where: {
      userId,
      folderId,
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
    include: {
      sender: {
        select: {
          displayName: true,
          email: true,
          unthread: true,
        },
      },
    },
  });

  const threadCounts = await getThreadCounts(userId, messages);

  const withCounts = messages.map((m) => ({
    ...m,
    threadCount: threadCounts.get(m.id) ?? 1,
  }));

  return collapseToThreads(withCounts);
}

/**
 * Look up display names for recipient email addresses from the Sender table.
 */
async function getRecipientNames(
  userId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const senders = await db.sender.findMany({
    where: { userId, email: { in: unique } },
    select: { email: true, displayName: true },
  });

  const map = new Map<string, string>();
  for (const s of senders) {
    if (s.displayName) {
      map.set(s.email, s.displayName);
    }
  }
  return map;
}

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const sentFolder = await getSentFolder(session.user.id);

  if (!sentFolder) {
    return (
      <div className="flex h-full flex-col">
        <PageMasthead eyebrow="Outbound" title="Sent" />
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={<Send />}
            title="No sent folder found"
            description="Sync your mailbox to see sent messages."
          />
        </div>
      </div>
    );
  }

  const { q } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  // Search contacts alongside messages
  const contacts = isSearching ? await searchContacts(session.user.id, q) : [];

  const rawMessages = isSearching
    ? await searchMessages(
        session.user.id,
        q,
        Prisma.sql`AND "folderId" = ${sentFolder.id}`,
      )
    : await getSentMessages(session.user.id, sentFolder.id);

  // For sent messages, show recipient instead of sender
  const recipientEmails = rawMessages
    .map((m) => m.toAddresses?.[0])
    .filter(Boolean) as string[];
  const recipientNames = await getRecipientNames(
    session.user.id,
    recipientEmails,
  );

  const messages = rawMessages.map((m) => {
    const recipientEmail = m.toAddresses?.[0];
    if (!recipientEmail) return m;

    return {
      ...m,
      fromName: recipientNames.get(recipientEmail) || recipientEmail,
      fromAddress: recipientEmail,
      sender: null,
    };
  });

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Outbound"
        title="Sent"
        actions={<SearchInput />}
      />

      <div className="flex-1 overflow-auto">
        {/* Contact results when searching */}
        {isSearching && contacts.length > 0 && (
          <div className="border-b px-4 py-3 md:px-6">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Contacts
            </h3>
            <div>
              {contacts.map((contact) => (
                <ContactResultRow key={contact.id} contact={contact} />
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.length === 0 && contacts.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title={isSearching ? "No results found" : "No sent messages"}
            description={
              isSearching
                ? `No messages or contacts match “${q}”`
                : "Messages you send will appear here."
            }
          />
        ) : (
          <div>
            {isSearching && contacts.length > 0 && messages.length > 0 && (
              <div className="px-4 pb-1 pt-3 md:px-6">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Messages
                </h3>
              </div>
            )}
            {messages.length > 0 && (
              <MessageList
                messages={messages}
                basePath="/sent"
                showFollowUpAction
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
