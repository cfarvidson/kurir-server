import { Phone, Briefcase, Building2 } from "lucide-react";
import type { PersonProfile } from "@/lib/mail/person-profile";
import type { PersonStats } from "@/lib/mail/person-stats";
import type { SourcedValue } from "@/lib/mail/signature-extract";
import {
  formatRank,
  formatResponseTime,
  histogramFractions,
} from "@/lib/mail/person-format";
import { cn } from "@/lib/utils";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function SourceTag({ source }: { source: SourcedValue["source"] }) {
  if (source !== "signature") return null;
  return (
    <span className="eyebrow ml-1.5 text-[9px] text-muted-foreground/80">
      from signature
    </span>
  );
}

function DetailRow({
  icon: Icon,
  item,
  href,
}: {
  icon: typeof Phone;
  item: SourcedValue;
  href?: string;
}) {
  const body = (
    <span className="truncate">
      {item.value}
      <SourceTag source={item.source} />
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      {href ? (
        <a
          href={href}
          className="min-w-0 truncate text-foreground transition-colors hover:text-primary"
        >
          {body}
        </a>
      ) : (
        <span className="min-w-0 truncate text-foreground">{body}</span>
      )}
    </div>
  );
}

/**
 * Contact details at the top of the person pane: phones, title, company.
 * Values from a Contact record show plain; values lifted from a signature
 * carry a "from signature" tag. Renders nothing when there is nothing.
 */
export function PersonProfileHeader({
  profile,
  className,
}: {
  profile: Pick<PersonProfile, "phones" | "title" | "company">;
  className?: string;
}) {
  const hasAny =
    profile.phones.length > 0 || profile.title !== null || profile.company !== null;
  if (!hasAny) return null;

  return (
    <div className={cn("space-y-1", className)} data-testid="person-profile-header">
      {profile.title && <DetailRow icon={Briefcase} item={profile.title} />}
      {profile.company && <DetailRow icon={Building2} item={profile.company} />}
      {profile.phones.map((phone) => (
        <DetailRow
          key={phone.value}
          icon={Phone}
          item={phone}
          href={`tel:${phone.value.replace(/[^\d+]/g, "")}`}
        />
      ))}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow text-[9px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * The Stats section: counts, first/last contact, median response times,
 * a 24-bar arrival-hour histogram, and Rank. Bars are plain divs on the
 * primary token; no chart library.
 */
export function PersonStatsSection({
  stats,
  timeZone,
  className,
}: {
  stats: PersonStats;
  timeZone: string;
  className?: string;
}) {
  const total = stats.sentToThem + stats.receivedFromThem;
  if (total === 0) return null;

  const theirs = formatResponseTime(stats.medianTheirReplySeconds);
  const yours = formatResponseTime(stats.medianYourReplySeconds);
  const rank = formatRank(stats.rank.position, stats.rank.of);
  const fractions = histogramFractions(stats.hourHistogram);
  const hasHistogram = stats.receivedFromThem > 0;

  return (
    <div className={cn("space-y-3", className)} data-testid="person-stats">
      <p className="eyebrow text-muted-foreground">Stats</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <StatCell label="Sent to them" value={String(stats.sentToThem)} />
        <StatCell label="Received" value={String(stats.receivedFromThem)} />
        {stats.firstAt && (
          <StatCell label="First contact" value={formatDate(stats.firstAt)} />
        )}
        {stats.lastAt && (
          <StatCell label="Last contact" value={formatDate(stats.lastAt)} />
        )}
        {theirs && <StatCell label="They reply in" value={theirs} />}
        {yours && <StatCell label="You reply in" value={yours} />}
      </div>

      {hasHistogram && (
        <div>
          <p className="eyebrow mb-1 text-[9px] text-muted-foreground">
            When their mail arrives
          </p>
          <div
            className="flex h-8 items-end gap-px"
            role="img"
            aria-label={`Arrival hours in ${timeZone}`}
            title={`Local time (${timeZone})`}
          >
            {fractions.map((fraction, hour) => (
              <div
                key={hour}
                className="flex-1 rounded-t-[1px] bg-primary/70"
                style={{
                  height: `${Math.max(fraction * 100, fraction > 0 ? 8 : 0)}%`,
                  minHeight: fraction > 0 ? 2 : 0,
                }}
                title={`${String(hour).padStart(2, "0")}:00 - ${stats.hourHistogram[hour]}`}
              />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] tabular-nums text-muted-foreground">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
      )}

      {rank && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{rank.split(" ")[0]}</span>{" "}
          {rank.slice(rank.indexOf(" ") + 1)}
        </p>
      )}
    </div>
  );
}
