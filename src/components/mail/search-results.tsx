import { Suspense } from "react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  BookUser,
  ChevronRight,
  Inbox,
  Loader2,
  Newspaper,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { searchMessages } from "@/lib/mail/search";
import {
  searchContacts,
  type ContactSearchResult,
} from "@/lib/mail/search-contacts";
import { searchFiles } from "@/lib/mail/search-files";
import { MessageList } from "@/components/mail/message-list";
import { EmptyState } from "@/components/mail/empty-state";
import { SearchFilesGroup } from "@/components/mail/search-files-group";
import { SearchAppointmentsGroup } from "@/components/mail/search-appointments-group";
import { searchAppointments } from "@/lib/mail/person-appointments";
import {
  listLabelForSearchHit,
  MESSAGE_SEARCH_MIN_LENGTH,
  type MailListId,
} from "@/lib/mail/list-contract";

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

  return (
    <Link
      href={`/from/${encodeURIComponent(contact.email)}`}
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
  showFollowUpAction?: boolean;
  showUnarchiveAction?: boolean;
  list?: MailListId;
}

/**
 * People / Messages / Appointments / Files (kurir-ios#125). People answer from the first
 * character, ordered by Rank, and stream to the page first; message and
 * file hits need two characters and arrive behind a Suspense boundary.
 */
export async function SearchResults(props: SearchResultsProps) {
  const { userId, query } = props;
  const fullSearch = query.trim().length >= MESSAGE_SEARCH_MIN_LENGTH;
  const contacts = await searchContacts(userId, query);

  if (!fullSearch && contacts.length === 0) {
    return (
      <EmptyState
        icon={props.emptyIcon || <BookUser />}
        title="Keep typing"
        description={`No people match “${query}”; messages, appointments and files search from two characters`}
      />
    );
  }

  return (
    <div>
      {contacts.length > 0 && (
        <div className="border-b px-4 py-3 md:px-6">
          <h3 className="eyebrow mb-1 text-muted-foreground">People</h3>
          <div>
            {contacts.map((contact) => (
              <ContactResultRow key={contact.id} contact={contact} />
            ))}
          </div>
        </div>
      )}

      {fullSearch && (
        <Suspense
          fallback={
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground md:px-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching messages, appointments and files…
            </div>
          }
        >
          <MessageAndFileResults {...props} hasPeople={contacts.length > 0} />
        </Suspense>
      )}
    </div>
  );
}

async function MessageAndFileResults({
  userId,
  query,
  categoryFilter,
  basePath,
  emptyIcon,
  showArchiveAction,
  showSnoozeAction,
  showSnoozedUntil,
  showFollowUpAction,
  showUnarchiveAction,
  list,
  hasPeople,
}: SearchResultsProps & { hasPeople: boolean }) {
  const [messages, files, appointments] = await Promise.all([
    searchMessages(userId, query, categoryFilter),
    searchFiles(userId, query),
    searchAppointments(userId, query),
  ]);

  if (messages.length === 0 && files.length === 0 && appointments.length === 0) {
    if (hasPeople) return null;
    return (
      <EmptyState
        icon={emptyIcon || <BookUser />}
        title="No results found"
        description={`No people, messages, appointments or files match “${query}”`}
      />
    );
  }

  return (
    <>
      {messages.length > 0 && (
        <div>
          {hasPeople && (
            <div className="px-4 pb-1 pt-3 md:px-6">
              <h3 className="eyebrow text-muted-foreground">Messages</h3>
            </div>
          )}
          <MessageList
            messages={messages.map((message) => ({
              ...message,
              listLabel: listLabelForSearchHit(message),
            }))}
            basePath={basePath}
            list={list}
            showArchiveAction={showArchiveAction}
            showSnoozeAction={showSnoozeAction}
            showSnoozedUntil={showSnoozedUntil}
            showFollowUpAction={showFollowUpAction}
            showUnarchiveAction={showUnarchiveAction}
            keyboardNavigation
          />
        </div>
      )}

      {appointments.length > 0 && (
        <SearchAppointmentsGroup
          appointments={appointments}
          timeZone="UTC"
        />
      )}
      {files.length > 0 && <SearchFilesGroup files={files} />}
    </>
  );
}
