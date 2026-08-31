"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ExternalLink,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type { SenderCategory, SenderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import {
  PERSON_PANE_DEBOUNCE_MS,
  showsPersonPane,
} from "@/lib/mail/person-pane";
import { usePersonPaneStore } from "@/stores/person-pane-store";
import { CategoryPicker } from "@/components/mail/category-picker";

interface PaneThread {
  id: string;
  subject: string | null;
  receivedAt: string;
  threadCount: number;
  hasAttachments: boolean;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
}

interface PaneData {
  email: string;
  sender: {
    id: string;
    displayName: string | null;
    status: SenderStatus;
    category: SenderCategory | null;
    messageCount: number;
  } | null;
  firstEmailAt: string | null;
  lastEmailAt: string | null;
  recentThreads: PaneThread[];
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function timeAgo(iso: string): string {
  const diffDays = Math.floor(
    (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Xobni-style persistent person column (kurir-ios#115). Lives in the mail
 * layout beside the page; follows whatever row is focused or thread is
 * open. Loads are debounced and every response is checked against the
 * latest request so a slow reply for an earlier person is dropped.
 */
export function PersonPane({ ownEmails }: { ownEmails: string[] }) {
  const pathname = usePathname();
  const email = usePersonPaneStore((s) => s.email);
  const collapsed = usePersonPaneStore((s) => s.collapsed);
  const setCollapsed = usePersonPaneStore((s) => s.setCollapsed);
  const setOwnEmails = usePersonPaneStore((s) => s.setOwnEmails);
  const hydrateCollapsed = usePersonPaneStore((s) => s.hydrateCollapsed);

  const [query, setQuery] = useState("");
  const [data, setData] = useState<PaneData | null>(null);
  const [loading, setLoading] = useState(false);
  // The aside is display:none below lg; do not fetch for a phone.
  const [wide, setWide] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    setOwnEmails(ownEmails);
  }, [ownEmails, setOwnEmails]);

  useEffect(() => {
    hydrateCollapsed();
  }, [hydrateCollapsed]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // A new person starts from a blank filter.
  useEffect(() => {
    setQuery("");
  }, [email]);

  const visible = showsPersonPane(pathname);
  const active = visible && !collapsed && wide;

  useEffect(() => {
    if (!active || !email) return;
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ email });
        const q = query.trim();
        if (q) params.set("q", q);
        const res = await fetch(`/api/contacts/context?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PaneData;
        // Stale guard: only the latest request may paint.
        if (seq !== requestSeq.current) return;
        setData(json);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (seq !== requestSeq.current) return;
        setData(null);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, PERSON_PANE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, email, query]);

  if (!visible) return null;

  if (collapsed) {
    return (
      <aside className="hidden w-9 shrink-0 border-l lg:flex lg:flex-col lg:items-center lg:pt-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Show person pane"
          title="Show person pane"
        >
          <PanelRightOpen className="size-4" />
        </button>
      </aside>
    );
  }

  const showing = data && data.email === email ? data : null;
  const name =
    showing?.sender?.displayName || (email ? email.split("@")[0] : "");
  const filtering = query.trim().length > 0;

  return (
    <aside
      className="hidden w-[280px] shrink-0 flex-col border-l bg-background lg:flex"
      aria-label="Person"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="eyebrow text-muted-foreground">Person</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Hide person pane"
          title="Hide person pane"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {!email ? (
        <div className="flex flex-col items-center gap-2 px-6 pt-12 text-center">
          <UserRound className="size-5 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">
            Select a message to see who it is from.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* Search inside the profile: conversations only, across all lists */}
          <label className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label="Search conversations with this person"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear conversation search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </label>

          <div className="p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>

            {showing ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {showing.sender?.status === "APPROVED" &&
                  showing.sender.category ? (
                    <CategoryPicker
                      senderId={showing.sender.id}
                      currentCategory={showing.sender.category}
                    />
                  ) : showing.sender?.status === "PENDING" ? (
                    <span className="eyebrow text-muted-foreground">
                      Awaiting decision
                    </span>
                  ) : null}
                  {showing.sender && (
                    <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                      <Mail className="size-3" />
                      {showing.sender.messageCount}
                    </span>
                  )}
                </div>

                {(showing.firstEmailAt || showing.lastEmailAt) && (
                  <div className="mt-3 space-y-1">
                    {showing.firstEmailAt && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="size-3 shrink-0" />
                        <span>First: {formatDate(showing.firstEmailAt)}</span>
                      </div>
                    )}
                    {showing.lastEmailAt && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="size-3 shrink-0" />
                        <span>Last: {formatDate(showing.lastEmailAt)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4">
                  <p className="eyebrow mb-2 text-muted-foreground">
                    Conversations
                  </p>
                  {showing.recentThreads.length === 0 ? (
                    <p className="px-2 text-xs text-muted-foreground">
                      {filtering
                        ? "No conversations match."
                        : "No conversations yet."}
                    </p>
                  ) : (
                    <div className={cn("space-y-1", loading && "opacity-60")}>
                      {showing.recentThreads.map((thread) => {
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
                              {thread.isArchived && <span>Archive</span>}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Link
                  href={
                    showing.sender
                      ? `/contacts/${showing.sender.id}`
                      : `/from/${encodeURIComponent(email)}`
                  }
                  className="mt-4 flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  View all
                  <ExternalLink className="size-3" />
                </Link>
              </>
            ) : (
              <p className="mt-6 text-center text-xs text-muted-foreground">
                {loading ? "Loading…" : "No mail with this address yet."}
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
