"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarPlus,
  ChevronDown,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { SenderCategory, SenderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import {
  PERSON_PANE_DEBOUNCE_MS,
  groupThreadsBySubject,
  recentSubject,
  showsPersonPane,
} from "@/lib/mail/person-pane";
import {
  civilFromZoned,
  formatDateParam,
} from "@/lib/calendar/view-time";
import type { NetworkNeighbor } from "@/lib/mail/person-network-format";
import {
  aiVerdictOutcome,
  type AIVerdict,
} from "@/lib/mail/content-rules";
import { usePersonPaneStore } from "@/stores/person-pane-store";
import { CategoryPicker } from "@/components/mail/category-picker";
import {
  PaneDisclosure,
  usePaneSectionOpen,
} from "@/components/mail/pane-disclosure";
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

interface PaneAIVerdict extends AIVerdict {
  id: string;
  subject: string | null;
  receivedAt: string;
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
  /** Newest AI rule verdicts on this person's mail, hits and misses. */
  aiVerdicts?: PaneAIVerdict[];
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

const PEOPLE_LIMIT = 3;

/**
 * People (kurir-ios#117): the first few people on shared threads by name;
 * the rest of them and everyone on the same domain sit behind a toggle.
 * Choosing one switches the pane to that person.
 */
function PeopleSection({
  network,
  personEmail,
  onSelect,
}: {
  network: NetworkNeighbor[];
  personEmail: string;
  onSelect: (neighbor: NetworkNeighbor) => void;
}) {
  const [expanded, toggleExpanded] = usePaneSectionOpen("people");
  if (network.length === 0) return null;
  const shared = network.filter((n) => n.kind === "sharedThread");
  const shown = shared.slice(0, PEOPLE_LIMIT);
  const hidden = [
    ...shared.slice(PEOPLE_LIMIT),
    ...network.filter((n) => n.kind === "domain"),
  ];
  const domain = personEmail.split("@")[1] ?? "";
  const allDomain = hidden.every((n) => n.kind === "domain");
  const moreLabel =
    allDomain && domain
      ? `+${hidden.length} more at ${domain}`
      : `+${hidden.length} more`;

  const row = (neighbor: NetworkNeighbor) => (
    <button
      key={neighbor.email}
      type="button"
      onClick={() => onSelect(neighbor)}
      title={neighbor.email}
      className="block w-full truncate rounded-md px-2 py-1 text-left text-xs font-medium transition-colors hover:bg-muted"
    >
      {neighbor.displayName || neighbor.email.split("@")[0]}
    </button>
  );

  return (
    <div className="mt-4">
      <p className="eyebrow mb-2 text-muted-foreground">People</p>
      <div className="space-y-0.5">
        {shown.map(row)}
        {expanded && hidden.map(row)}
      </div>
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="mt-1 flex items-center gap-1 px-2 text-xs font-medium tabular-nums text-primary transition-colors hover:text-primary/80"
        >
          {expanded ? "Show fewer" : moreLabel}
          <ChevronDown
            className={cn("size-3 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}

/** The latest AI rule verdict on this person's mail, as one line. */
function AIVerdictLine({ verdict }: { verdict: PaneAIVerdict }) {
  const title = verdict.reason
    ? `"${verdict.criterion}" - ${verdict.reason}`
    : `"${verdict.criterion}"`;
  return (
    <Link
      href={`${getThreadRoute(verdict)}/${verdict.id}`}
      data-ai-verdict={verdict.matched ? "matched" : "no-match"}
      title={title}
      className={cn(
        "mt-4 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted",
        verdict.matched ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="truncate">{aiVerdictOutcome(verdict)}</span>
      <span className="shrink-0 font-normal text-muted-foreground">
        · {timeAgo(verdict.receivedAt)}
      </span>
    </Link>
  );
}

const LINK_LIMIT = 12;
const APPOINTMENT_LIMIT = 12;
const UPCOMING_LIMIT = 2;

function isPast(appointment: PaneAppointment): boolean {
  return new Date(appointment.startAt).getTime() < Date.now();
}

function ShowAllButton({
  total,
  showAll,
  onToggle,
}: {
  total: number;
  showAll: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-1 px-2 text-xs font-medium tabular-nums text-primary"
    >
      {showAll ? "Show fewer" : `Show all (${total})`}
    </button>
  );
}

function LinksSection({
  links,
  filtering,
  showAll,
  onToggleShowAll,
}: {
  links: PaneLink[];
  filtering: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (links.length === 0) return null;
  const shown = showAll ? links : links.slice(0, LINK_LIMIT);
  return (
    <PaneDisclosure
      name="links"
      title="Links"
      count={links.length}
      forceOpen={filtering}
      className="mt-4"
    >
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
        <ShowAllButton
          total={links.length}
          showAll={showAll}
          onToggle={onToggleShowAll}
        />
      )}
    </PaneDisclosure>
  );
}

function AppointmentRows({
  appointments,
  timeZone,
}: {
  appointments: PaneAppointment[];
  timeZone: string;
}) {
  return (
    <div className="space-y-0.5">
      {appointments.map((appointment) => {
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
  );
}

/**
 * The next upcoming appointments stay visible; the rest (later upcoming
 * and past) sit in a disclosure. Input is upcoming soonest first, then
 * past newest first.
 */
function AppointmentsSection({
  appointments,
  timeZone,
  filtering,
  showAll,
  onToggleShowAll,
}: {
  appointments: PaneAppointment[];
  timeZone: string;
  filtering: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (appointments.length === 0) return null;
  const pinned = appointments.filter((a) => !isPast(a)).slice(0, UPCOMING_LIMIT);
  const rest = appointments.filter((a) => !pinned.includes(a));
  const shownRest = showAll ? rest : rest.slice(0, APPOINTMENT_LIMIT);
  return (
    <div className="mt-4">
      {pinned.length > 0 && (
        <>
          <p className="eyebrow mb-2 text-muted-foreground">Appointments</p>
          <AppointmentRows appointments={pinned} timeZone={timeZone} />
        </>
      )}
      {rest.length > 0 && (
        <PaneDisclosure
          name="appointments"
          title={
            pinned.length === 0
              ? "Appointments"
              : `${rest.length} ${rest.every(isPast) ? "earlier" : "more"}`
          }
          count={pinned.length === 0 ? rest.length : undefined}
          forceOpen={filtering}
          className={pinned.length > 0 ? "mt-2" : undefined}
        >
          <AppointmentRows appointments={shownRest} timeZone={timeZone} />
          {rest.length > APPOINTMENT_LIMIT && (
            <ShowAllButton
              total={rest.length}
              showAll={showAll}
              onToggle={onToggleShowAll}
            />
          )}
        </PaneDisclosure>
      )}
    </div>
  );
}

const RECENT_LIMIT = 3;

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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [showAllAppointments, setShowAllAppointments] = useState(false);
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

  // A new person starts from a closed, blank search and capped lists.
  useEffect(() => {
    setQuery("");
    setSearchOpen(false);
    setShowAllLinks(false);
    setShowAllAppointments(false);
  }, [email]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

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
  const showSearch = searchOpen || query.length > 0;
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  return (
    <aside
      className="hidden w-[280px] shrink-0 flex-col border-l bg-background lg:flex"
      aria-label="Person"
    >
      <div className="flex items-center gap-1 px-4 pt-3">
        <span className="eyebrow mr-auto text-muted-foreground">Person</span>
        {email && (
          <button
            type="button"
            onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))}
            className={cn(
              "rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground",
              showSearch ? "text-foreground" : "text-muted-foreground",
            )}
            aria-label="Search profile"
            aria-expanded={showSearch}
            title="Search profile"
          >
            <Search className="size-4" />
          </button>
        )}
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
          {showSearch && (
            <label className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-ring">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchInput}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Search profile"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                aria-label="Search profile"
              />
              <button
                type="button"
                onClick={closeSearch}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear profile search"
              >
                <X className="size-3.5" />
              </button>
            </label>
          )}

          <div className="p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Link
                  href={`/compose?to=${encodeURIComponent(email)}&from=${encodeURIComponent(pathname ?? "/imbox")}`}
                  className="rounded-md p-1 text-primary transition-colors hover:bg-muted hover:text-primary/80"
                  aria-label="Email"
                  title="Email"
                >
                  <Mail className="size-4" />
                </Link>
                {showing?.scheduleDraft && (
                  <Link
                    href={`/compose?to=${encodeURIComponent(showing.scheduleDraft.to)}&subject=${encodeURIComponent(showing.scheduleDraft.subject)}&body=${encodeURIComponent(showing.scheduleDraft.body)}&from=${encodeURIComponent(pathname ?? "/imbox")}`}
                    className="rounded-md p-1 text-primary transition-colors hover:bg-muted hover:text-primary/80"
                    aria-label="Schedule time"
                    title="Schedule time"
                  >
                    <CalendarPlus className="size-4" />
                  </Link>
                )}
              </div>
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

                {/* Fact line, busy hours, histogram; Details behind a click */}
                <PersonStatsSection
                  stats={showing.profile.stats}
                  timeZone={showing.profile.timeZone}
                  className="mt-4"
                />

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="eyebrow text-muted-foreground">Recent</p>
                    <Link
                      href={
                        showing.sender
                        ? `/contacts/${showing.sender.id}`
                        : `/from/${encodeURIComponent(email)}`
                      }
                      className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      View all
                    </Link>
                  </div>
                  {(() => {
                    const groups = groupThreadsBySubject(
                      showing.recentThreads,
                      (thread) => thread.subject,
                    );
                    if (groups.length === 0) {
                      return (
                        <p className="px-2 text-xs text-muted-foreground">
                          {filtering
                            ? "No conversations match."
                            : "No conversations yet."}
                        </p>
                      );
                    }
                    const shown = filtering
                      ? groups
                      : groups.slice(0, RECENT_LIMIT);
                    return (
                      <div className={cn("space-y-0.5", loading && "opacity-60")}>
                        {shown.map(({ thread, count }) => (
                          <Link
                            key={thread.id}
                            href={`${getThreadRoute(thread)}/${thread.id}`}
                            className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {recentSubject(thread.subject, name)}
                            </span>
                            {count > 1 && (
                              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                ×{count}
                              </span>
                            )}
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {timeAgo(thread.receivedAt)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <PeopleSection
                  network={showing.network}
                  personEmail={email}
                  onSelect={(neighbor) => setEmail(neighbor.email)}
                />

                {showing.aiVerdicts?.[0] && (
                  <AIVerdictLine verdict={showing.aiVerdicts[0]} />
                )}

                <LinksSection
                  links={(showing.links ?? []).filter((link) => {
                    const needle = query.trim().toLowerCase();
                    if (!needle) return true;
                    return (
                      link.title.toLowerCase().includes(needle) ||
                      link.url.toLowerCase().includes(needle)
                    );
                  })}
                  filtering={filtering}
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
                  filtering={filtering}
                  showAll={showAllAppointments}
                  onToggleShowAll={() => setShowAllAppointments((v) => !v)}
                />

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
