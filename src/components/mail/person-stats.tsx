"use client";

import type { PersonRank } from "@/lib/mail/person-stats";
import {
  formatBusyHours,
  formatDate,
  formatRank,
  formatRepliesIn,
  formatResponseTime,
  histogramFractions,
} from "@/lib/mail/person-format";
import { cn } from "@/lib/utils";

/**
 * `PersonStats` as it arrives over JSON (dates as ISO strings) or straight
 * from `getContactContext` in a server component (Date objects).
 */
export interface PersonStatsData {
  sentToThem: number;
  receivedFromThem: number;
  firstAt: Date | string | null;
  lastAt: Date | string | null;
  medianTheirReplySeconds: number | null;
  medianYourReplySeconds: number | null;
  hourHistogram: number[];
  rank: PersonRank;
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
 * primary token; no chart library. Client component fed by the JSON of
 * `getContactContext`.
 */
export function PersonStatsSection({
  stats,
  timeZone,
  className,
}: {
  stats: PersonStatsData;
  timeZone: string;
  className?: string;
}) {
  const total = stats.sentToThem + stats.receivedFromThem;
  if (total === 0) return null;

  const replies = formatRepliesIn(stats.medianTheirReplySeconds);
  const busyHours = formatBusyHours(stats.hourHistogram);
  const yours = formatResponseTime(stats.medianYourReplySeconds);
  const rank = formatRank(stats.rank.position, stats.rank.of);
  const fractions = histogramFractions(stats.hourHistogram);
  const hasHistogram = stats.receivedFromThem > 0;

  return (
    <div className={cn("space-y-3", className)} data-testid="person-stats">
      <p className="eyebrow text-muted-foreground">Stats</p>

      {replies && (
        <p className="text-xs font-medium tabular-nums text-foreground">{replies}</p>
      )}
      {busyHours && (
        <p className="text-xs font-medium tabular-nums text-foreground">
          {busyHours}
        </p>
      )}

      {hasHistogram && (
        <div>
          <p className="eyebrow mb-1 text-[9px] text-muted-foreground">
            When they write
          </p>
          <div
            className="flex h-8 items-end gap-px"
            role="img"
            aria-label={`When they write in ${timeZone}`}
            title={`Local time (${timeZone})`}
          >
            {fractions.map((fraction, hour) => (
              <div
                key={hour}
                className="flex-1 rounded-t-xs bg-primary/70"
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <StatCell label="Sent to them" value={String(stats.sentToThem)} />
        <StatCell label="Received" value={String(stats.receivedFromThem)} />
        {stats.firstAt && (
          <StatCell label="First contact" value={formatDate(new Date(stats.firstAt))} />
        )}
        {stats.lastAt && (
          <StatCell label="Last contact" value={formatDate(new Date(stats.lastAt))} />
        )}
        {yours && <StatCell label="You reply in" value={yours} />}
      </div>

      {rank && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {rank.badge}
          </span>{" "}
          {rank.tail}
        </p>
      )}
    </div>
  );
}
