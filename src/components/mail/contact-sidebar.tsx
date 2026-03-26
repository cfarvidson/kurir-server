import Link from "next/link";
import { Mail, Calendar, ExternalLink } from "lucide-react";
import { getContactContext, getThreadRoute } from "@/lib/mail/contact-context";
import { CategoryPicker } from "@/components/mail/category-picker";

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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

interface ContactSidebarProps {
  userId: string;
  contactEmail: string;
}

export async function ContactSidebar({
  userId,
  contactEmail,
}: ContactSidebarProps) {
  const context = await getContactContext(userId, contactEmail);

  if (!context.sender && context.recentThreads.length === 0) {
    return null;
  }

  const name = context.sender?.displayName || contactEmail.split("@")[0];

  return (
    <div className="hidden w-[280px] shrink-0 border-l lg:block">
      <div className="overflow-auto p-4">
        {/* Avatar and name */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${getInitialColor(contactEmail)}`}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {contactEmail}
            </p>
          </div>
        </div>

        {/* Category badge and stats */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {context.sender?.status === "APPROVED" && context.sender.category ? (
            <CategoryPicker
              senderId={context.sender.id}
              currentCategory={context.sender.category}
            />
          ) : context.sender?.status === "PENDING" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Awaiting decision
            </span>
          ) : null}

          {context.sender && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Mail className="h-3 w-3" />
              {context.sender.messageCount}
            </span>
          )}
        </div>

        {/* First/last email dates */}
        {(context.firstEmailAt || context.lastEmailAt) && (
          <div className="mt-3 space-y-1">
            {context.firstEmailAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>First: {formatDate(context.firstEmailAt)}</span>
              </div>
            )}
            {context.lastEmailAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>Last: {formatDate(context.lastEmailAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* Recent threads */}
        {context.recentThreads.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent threads
            </p>
            <div className="space-y-1">
              {context.recentThreads.map((thread) => {
                const route = getThreadRoute(thread);
                return (
                  <Link
                    key={thread.id}
                    href={`${route}/${thread.id}`}
                    className="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
                  >
                    <p className="truncate text-xs font-medium">
                      {thread.subject || "(no subject)"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{timeAgo(thread.receivedAt)}</span>
                      {thread.threadCount > 1 && (
                        <span className="rounded bg-muted px-1">
                          {thread.threadCount}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* View all link */}
        {context.sender && (
          <Link
            href={`/contacts/${context.sender.id}`}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            View all
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
