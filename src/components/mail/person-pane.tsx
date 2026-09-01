"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  threadIsDirect,
} from "@/lib/mail/person-pane";
import {
  civilFromZoned,
  formatDateParam,
} from "@/lib/calendar/view-time";
import {
  NETWORK_LIMIT,
  networkStrengthLabel,
  type NetworkNeighbor,
} from "@/lib/mail/person-network-format";
import { usePersonPaneStore } from "@/stores/person-pane-store";
import { CategoryPicker } from "@/components/mail/category-picker";
import {
  PersonProfileHeader,
  type PersonProfileHeaderData,
} from "@/components/mail/person-profile-header";
import {
  PersonStatsSection,
  type PersonStatsData,
} from "@/components/mail/person-stats";

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
  fromAddress?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
}

interface PaneLink {
  id: string;
  url: string;
  title: string;
  receivedAt: string;
}

interface PaneAppointment {
  id: string;
  title: string;
  startAt: string;
  isAllDay: boolean;
  attendees?: { email: string; name: string | null }[];
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
  /** Signature details, stats and Rank (kurir-ios#116). */
  profile: PersonProfileHeaderData & {
    displayName: string;
    timeZone: string;
    stats: PersonStatsData;
  };
  /** Shared-thread and same-domain people by strength (kurir-ios#117). */
  network: NetworkNeighbor[];
  links: PaneLink[];
  appointments: PaneAppointment[];
  scheduleDraft: { to: string; subject: string; body: string };
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
 * Network (kurir-ios#117): people on shared threads and on the same domain,
 * strongest first. Choosing one switches the pane to that person.
 */
function NetworkSection({
  network,
  showAll,
  onToggleShowAll,
  onSelect,
}: {
  network: NetworkNeighbor[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onSelect: (neighbor: NetworkNeighbor) => void;
}) {
  const shown = showAll ? network : network.slice(0, NETWORK_LIMIT);
  const hidden = network.length - NETWORK_LIMIT;
  return (
    <div className="mt-4">
      <p className="eyebrow mb-2 text-muted-foreground">Network</p>
      <div className="space-y-0.5">
        {shown.map((neighbor) => (
          <button
            key={neighbor.email}
            type="button"
            onClick={() => onSelect(neighbor)}
            className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
          >
            <p className="truncate text-xs font-medium">
              {neighbor.displayName || neighbor.email.split("@")[0]}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              <span className="tabular-nums">
                {networkStrengthLabel(neighbor)}
              </span>
              {" · "}
              {neighbor.email}
            </p>
          </button>
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-1 px-2 text-xs font-medium tabular-nums text-primary transition-colors hover:text-primary/80"
        >
          {showAll ? "Show fewer" : `Show all (${network.length})`}
        </button>
      )}
    </div>
  );
}

const LINK_LIMIT = 12;
const APPOINTMENT_LIMIT = 12;

function LinksSection({
  links,
  showAll,
  onToggleShowAll,
}: {
  links: PaneLink[];
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (links.length === 0) return null;
  const shown = showAll ? links : links.slice(0, LINK_LIMIT);
  return (
    <div className="mt-4">
      <p className="eyebrow mb-2 text-muted-foreground">Links exchanged</p>
      <div className="space-y-0.5">
        {shown.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
          >
            <p className="truncate text-xs font-medium">{link.title}</p>
            <p className="text-[10px] text-muted-foreground">
              {timeAgo(link.receivedAt)}
            </p>
          </a>
        ))}
      </div>
      {links.length > LINK_LIMIT && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-1 px-2 text-xs font-medium tabular-nums text-primary"
        >
          {showAll ? "Show fewer" : `Show all (${links.length})`}
        </button>
      )}
    </div>
  );
}

function AppointmentsSection({
  appointments,
  timeZone,
  showAll,
  onToggleShowAll,
}: {
  appointments: PaneAppointment[];
  timeZone: string;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (appointments.length === 0) return null;
  const shown = showAll ? appointments : appointments.slice(0, APPOINTMENT_LIMIT);
  return (
    <div className="mt-4">
      <p className="eyebrow mb-2 text-muted-foreground">Appointments</p>
      <div className="space-y-0.5">
        {shown.map((appointment) => {
          const start = new Date(appointment.startAt);
          const href = `/calendar/day?date=${formatDateParam(civilFromZoned(start, timeZone))}`;
          const when = appointment.isAllDay
            ? `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · All-day`
            : start.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
          return (
            <Link
              key={appointment.id}
              href={href}
              className="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
            >
              <p className="truncate text-xs font-medium">{appointment.title}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">{when}</p>
            </Link>
          );
        })}
      </div>
      {appointments.length > APPOINTMENT_LIMIT && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-1 px-2 text-xs font-medium tabular-nums text-primary"
        >
          {showAll ? "Show fewer" : `Show all (${appointments.length})`}
        </button>
      )}
    </div>
  );
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
  const setEmail = usePersonPaneStore((s) => s.setEmail);
  const collapsed = usePersonPaneStore((s) => s.collapsed);
  const setCollapsed = usePersonPaneStore((s) => s.setCollapsed);
  const setOwnEmails = usePersonPaneStore((s) => s.setOwnEmails);
  const hydrateCollapsed = usePersonPaneStore((s) => s.hydrateCollapsed);

  const [query, setQuery] = useState("");
  const [showAllNetwork, setShowAllNetwork] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [showAllAppointments, setShowAllAppointments] = useState(false);
  const [directOnly, setDirectOnly] = useState(false);
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

  // A new person starts from a blank filter and a capped Network.
  useEffect(() => {
    setQuery("");
    setShowAllNetwork(false);
    setShowAllLinks(false);
    setShowAllAppointments(false);
    setDirectOnly(false);
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
        // Histogram buckets in the browser's zone, not the account's.
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) params.set("tz", tz);
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
    showing?.profile.displayName ||
    showing?.sender?.displayName ||
    (email ? email.split("@")[0] : "");
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
          {/* Search inside the profile: conversations, links, appointments */}
          <label className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search profile"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label="Search profile"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear profile search"
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
            <div className="mt-2 flex items-center gap-3">
              <Link
                href={`/compose?to=${encodeURIComponent(email)}&from=${encodeURIComponent(pathname ?? "/imbox")}`}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                Email
              </Link>
              {showing?.scheduleDraft && (
                <Link
                  href={`/compose?to=${encodeURIComponent(showing.scheduleDraft.to)}&subject=${encodeURIComponent(showing.scheduleDraft.subject)}&body=${encodeURIComponent(showing.scheduleDraft.body)}&from=${encodeURIComponent(pathname ?? "/imbox")}`}
                  className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Schedule time
                </Link>
              )}
            </div>

            {showing ? (
              <>
                <PersonProfileHeader
                  profile={showing.profile}
                  className="mt-2"
                />

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

                {/* First/last contact, counts, reply times, histogram, Rank */}
                <PersonStatsSection
                  stats={showing.profile.stats}
                  timeZone={showing.profile.timeZone}
                  className="mt-4"
                />

                {showing.network.length > 0 && (
                  <NetworkSection
                    network={showing.network}
                    showAll={showAllNetwork}
                    onToggleShowAll={() => setShowAllNetwork((v) => !v)}
                    onSelect={(neighbor) => setEmail(neighbor.email)}
                  />
                )}

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="eyebrow text-muted-foreground">
                      Conversations
                    </p>
                    <button
                      type="button"
                      onClick={() => setDirectOnly((v) => !v)}
                      className="text-[11px] font-medium text-primary"
                    >
                      {directOnly ? "All" : "Direct only"}
                    </button>
                  </div>
                  {(() => {
                    const threads = showing.recentThreads.filter(
                      (thread) =>
                        !directOnly ||
                        threadIsDirect(thread, email, ownEmails),
                    );
                    if (threads.length === 0) {
                      return (
                    <p className="px-2 text-xs text-muted-foreground">
                      {directOnly
                        ? "No direct conversations."
                        : filtering
                        ? "No conversations match."
                        : "No conversations yet."}
                    </p>
                      );
                    }
                    return (
                    <div className={cn("space-y-1", loading && "opacity-60")}>
                      {threads.map((thread) => {
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
                    );
                  })()}
                </div>

                <LinksSection
                  links={(showing.links ?? []).filter((link) => {
                    const needle = query.trim().toLowerCase();
                    if (!needle) return true;
                    return (
                      link.title.toLowerCase().includes(needle) ||
                      link.url.toLowerCase().includes(needle)
                    );
                  })}
                  showAll={showAllLinks}
                  onToggleShowAll={() => setShowAllLinks((v) => !v)}
                />

                <AppointmentsSection
                  appointments={(showing.appointments ?? []).filter(
                    (appointment) => {
                      const needle = query.trim().toLowerCase();
                      if (!needle) return true;
                      if (appointment.title.toLowerCase().includes(needle)) {
                        return true;
                      }
                      return (appointment.attendees ?? []).some(
                        (attendee) =>
                          attendee.email.toLowerCase().includes(needle) ||
                          (attendee.name ?? "")
                            .toLowerCase()
                            .includes(needle),
                      );
                    },
                  )}
                  timeZone={showing.profile.timeZone}
                  showAll={showAllAppointments}
                  onToggleShowAll={() => setShowAllAppointments((v) => !v)}
                />

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
