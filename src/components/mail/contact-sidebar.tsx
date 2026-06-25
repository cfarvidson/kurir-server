import Link from "next/link";
import { Mail, Calendar, ExternalLink } from "lucide-react";
import { getContactContext } from "@/lib/mail/contact-context";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import { CategoryPicker } from "@/components/mail/category-picker";

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
        {/* Name */}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {contactEmail}
          </p>
        </div>

        {/* Category badge and stats */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {context.sender?.status === "APPROVED" && context.sender.category ? (
            <CategoryPicker
              senderId={context.sender.id}
              currentCategory={context.sender.category}
            />
          ) : context.sender?.status === "PENDING" ? (
            <span className="eyebrow text-muted-foreground">
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
            <p className="eyebrow mb-2 text-muted-foreground">Recent threads</p>
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
                        <span className="font-mono tabular-nums">
                          ·{thread.threadCount}
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
