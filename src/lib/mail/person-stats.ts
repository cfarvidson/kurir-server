import { isOwnAddress, type OwnAddresses } from "@/lib/mail/user-emails";

/**
 * Person statistics and Rank, computed over message rows (no DB here so the
 * same code path serves the profile endpoint and the tests). The iOS/Mac
 * client mirrors this file in `PersonStats.swift`; both are pinned to the
 * shared fixture `src/__tests__/fixtures/person-rank.json`. Change the
 * formula in both places or not at all. See docs/person-rank.md.
 *
 * Rank formula:
 *
 *   score(person) = sum over exchanged messages m of
 *                   0.5 ^ (ageDays(m) / 90) * (2 if m is a reply else 1)
 *
 * where "exchanged" is every message from the person plus every message
 * from one of the user's own addresses with the person on To or Cc,
 * ageDays = (now - receivedAt) / 86400 (clamped at 0 for future-dated mail),
 * and "reply" means the message carries an In-Reply-To header. Position is
 * the 1-based place of the person among all counterparts of the user when
 * sorted by score descending (ties broken by email ascending).
 */

export const RANK_HALF_LIFE_DAYS = 90;
export const RANK_REPLY_MULTIPLIER = 2;

export interface PersonStatsMessage {
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
  messageId: string | null;
  inReplyTo: string | null;
}

export interface PersonRank {
  score: number;
  /** 1-based position among all counterparts; null when the person has none. */
  position: number | null;
  /** Number of ranked counterparts ("#3 of 41"). */
  of: number;
}

export interface PersonStats {
  sentToThem: number;
  receivedFromThem: number;
  firstAt: Date | null;
  lastAt: Date | null;
  /** Median of (their reply - your message) over In-Reply-To pairs. */
  medianTheirReplySeconds: number | null;
  /** Median of (your reply - their message) over In-Reply-To pairs. */
  medianYourReplySeconds: number | null;
  /** 24 buckets, local hour of arrival (in `timeZone`) of mail from them. */
  hourHistogram: number[];
  rank: PersonRank;
}

export interface RankedPerson {
  email: string;
  score: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function norm(email: string): string {
  return email.trim().toLowerCase();
}

function isReply(m: PersonStatsMessage): boolean {
  return !!m.inReplyTo && m.inReplyTo.trim().length > 0;
}

/** Weight of one exchanged message in the Rank score. */
export function rankWeight(receivedAt: Date, reply: boolean, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - receivedAt.getTime()) / DAY_MS);
  const decay = Math.pow(0.5, ageDays / RANK_HALF_LIFE_DAYS);
  return decay * (reply ? RANK_REPLY_MULTIPLIER : 1);
}

/**
 * Score every counterpart of the user in one pass. A message from an own
 * address credits each distinct non-own To/Cc address; a message from anyone
 * else credits its sender only (their Cc list is not the user's counterpart).
 */
export function rankPeople(
  messages: PersonStatsMessage[],
  own: OwnAddresses,
  now: Date,
): RankedPerson[] {
  const scores = new Map<string, number>();
  for (const m of messages) {
    const w = rankWeight(m.receivedAt, isReply(m), now);
    const from = norm(m.fromAddress);
    if (isOwnAddress(from, own)) {
      const seen = new Set<string>();
      for (const raw of [...m.toAddresses, ...m.ccAddresses]) {
        const addr = norm(raw);
        if (!addr || seen.has(addr) || isOwnAddress(addr, own)) continue;
        seen.add(addr);
        scores.set(addr, (scores.get(addr) ?? 0) + w);
      }
    } else if (from) {
      scores.set(from, (scores.get(from) ?? 0) + w);
    }
  }
  return [...scores.entries()]
    .map(([email, score]) => ({ email, score }))
    .sort((a, b) => b.score - a.score || (a.email < b.email ? -1 : 1));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function localHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour % 24 : 0;
}

export function computePersonStats(input: {
  /** Messages involving the person (a superset, e.g. all mail, is fine). */
  messages: PersonStatsMessage[];
  email: string;
  own: OwnAddresses;
  now: Date;
  timeZone: string;
  /**
   * Ranking over ALL of the user's mail. When omitted it is derived from
   * `messages`, which is only correct if `messages` is the whole mailbox.
   */
  ranking?: RankedPerson[];
}): PersonStats {
  const { messages, own, now, timeZone } = input;
  const email = norm(input.email);

  const fromThem: PersonStatsMessage[] = [];
  const toThem: PersonStatsMessage[] = [];
  for (const m of messages) {
    if (norm(m.fromAddress) === email) {
      fromThem.push(m);
    } else if (
      isOwnAddress(m.fromAddress, own) &&
      [...m.toAddresses, ...m.ccAddresses].some((a) => norm(a) === email)
    ) {
      toThem.push(m);
    }
  }

  const exchanged = [...fromThem, ...toThem];
  const times = exchanged.map((m) => m.receivedAt.getTime());
  const firstAt = times.length ? new Date(Math.min(...times)) : null;
  const lastAt = times.length ? new Date(Math.max(...times)) : null;

  // Reply pairing within the exchanged set: reply.inReplyTo -> parent.messageId.
  const byMessageId = new Map<string, PersonStatsMessage>();
  for (const m of exchanged) {
    if (m.messageId) byMessageId.set(m.messageId.trim(), m);
  }
  const theirReplies: number[] = [];
  const yourReplies: number[] = [];
  for (const reply of exchanged) {
    if (!isReply(reply)) continue;
    const parent = byMessageId.get(reply.inReplyTo!.trim());
    if (!parent) continue;
    const delta = (reply.receivedAt.getTime() - parent.receivedAt.getTime()) / 1000;
    if (delta <= 0) continue;
    const replyFromThem = norm(reply.fromAddress) === email;
    const parentFromThem = norm(parent.fromAddress) === email;
    if (replyFromThem && !parentFromThem) theirReplies.push(delta);
    else if (!replyFromThem && parentFromThem) yourReplies.push(delta);
  }

  const hourHistogram = new Array<number>(24).fill(0);
  for (const m of fromThem) {
    hourHistogram[localHour(m.receivedAt, timeZone)] += 1;
  }

  const ranked = input.ranking ?? rankPeople(messages, own, now);
  const index = ranked.findIndex((r) => r.email === email);

  return {
    sentToThem: toThem.length,
    receivedFromThem: fromThem.length,
    firstAt,
    lastAt,
    medianTheirReplySeconds: median(theirReplies),
    medianYourReplySeconds: median(yourReplies),
    hourHistogram,
    rank: {
      score: index >= 0 ? ranked[index].score : 0,
      position: index >= 0 ? index + 1 : null,
      of: ranked.length,
    },
  };
}
