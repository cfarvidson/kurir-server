import Link from "next/link";
import { Prisma } from "@prisma/client";
import { BookUser, ChevronRight, Inbox, Newspaper, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchMessages } from "@/lib/mail/search";
import {
  searchContacts,
  type ContactSearchResult,
} from "@/lib/mail/search-contacts";
import { MessageList } from "@/components/mail/message-list";

const categoryConfig = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: {
    label: "Feed",
    icon: Newspaper,
    color: "text-blue-600 dark:text-blue-400",
  },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color: "text-amber-600 dark:text-amber-400",
  },
} as const;

function ContactResultRow({ contact }: { contact: ContactSearchResult }) {
  const name = contact.displayName || contact.email.split("@")[0];
  const cat = categoryConfig[contact.category ?? "IMBOX"];
  const CatIcon = cat.icon;

  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60"
    >
      <BookUser className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {contact.email}
      </span>
      <CatIcon className={cn("ml-auto h-3.5 w-3.5 shrink-0", cat.color)} />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

interface SearchResultsProps {
  userId: string;
  query: string;
  categoryFilter: Prisma.Sql;
  basePath: string;
  emptyIcon?: React.ReactNode;
  showArchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSnoozedUntil?: boolean;
}

export async function SearchResults({
  userId,
  query,
  categoryFilter,
  basePath,
  emptyIcon,
  showArchiveAction,
  showSnoozeAction,
  showSnoozedUntil,
}: SearchResultsProps) {
  const [messages, contacts] = await Promise.all([
    searchMessages(userId, query, categoryFilter),
    searchContacts(userId, query),
  ]);

  if (messages.length === 0 && contacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        {emptyIcon || (
          <div className="rounded-full bg-muted p-4">
            <BookUser className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <h2 className="mt-4 text-lg font-medium">No results found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No messages or contacts match &quot;{query}&quot;
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Contact results */}
      {contacts.length > 0 && (
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

      {/* Message results */}
      {messages.length > 0 && (
        <div>
          {contacts.length > 0 && (
            <div className="px-4 pb-1 pt-3 md:px-6">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Messages
              </h3>
            </div>
          )}
          <MessageList
            messages={messages}
            basePath={basePath}
            showArchiveAction={showArchiveAction}
            showSnoozeAction={showSnoozeAction}
            showSnoozedUntil={showSnoozedUntil}
          />
        </div>
      )}
    </div>
  );
}
