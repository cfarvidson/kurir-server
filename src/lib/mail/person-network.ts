import { db } from "@/lib/db";
import { domainOf, rankWeight } from "@/lib/mail/person-stats";
import type { NetworkNeighbor } from "@/lib/mail/person-network-format";
import { isOwnAddress, type OwnAddresses } from "@/lib/mail/user-emails";

/**
 * Network (kurir-ios#117): the people around a person, replacing the pane's
 * Related senders. Two kinds of neighbour, one strength scale:
 *
 * - sharedThread: someone on a thread (From / To / Cc) the person is on.
 *   strength = sum over shared threads of 0.5 ^ (ageDays(thread) / 90),
 *   where a thread's age is that of its newest message. One fresh thread
 *   counts 1, a thread from three months ago 0.5.
 * - domain: someone on the person's domain with no shared thread. Their
 *   strength is their own Rank score (their exchanged mail with the user).
 *
 * Sorted by strength desc; at equal strength shared-thread neighbours come
 * before domain ones, then name, then address. Mirrored in
 * `PersonPane.swift` on iOS/Mac; both pinned to the shared fixture.
 */

export {
  NETWORK_LIMIT,
  networkStrengthLabel,
  type NetworkKind,
  type NetworkNeighbor,
} from "@/lib/mail/person-network-format";

export interface NetworkMessage {
  id: string;
  threadId: string | null;
  fromAddress: string;
  fromName?: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
}

export interface DomainPerson {
  email: string;
  displayName: string | null;
  score: number;
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

/** Weight of one shared thread whose newest message is `latestAt`. */
export function threadStrength(latestAt: Date, now: Date): number {
  return rankWeight(latestAt, false, now);
}

export function computeNetwork(input: {
  email: string;
  own: OwnAddresses;
  now: Date;
  /** Messages on threads the person is on (a superset is fine). */
  messages: NetworkMessage[];
  /** Same-domain counterparts with their Rank score. */
  domainPeople: DomainPerson[];
}): NetworkNeighbor[] {
  const email = norm(input.email);
  const { own, now } = input;

  const threads = new Map<string, NetworkMessage[]>();
  for (const m of input.messages) {
    const key = m.threadId ?? m.id;
    const list = threads.get(key);
    if (list) list.push(m);
    else threads.set(key, [m]);
  }

  const strength = new Map<string, number>();
  const counts = new Map<string, number>();
  const names = new Map<string, { name: string; at: number }>();

  for (const messages of threads.values()) {
    const participants = new Set<string>();
    let involved = false;
    let latest = -Infinity;
    for (const m of messages) {
      const addrs = [m.fromAddress, ...m.toAddresses, ...m.ccAddresses].map(norm);
      if (addrs.includes(email)) involved = true;
      for (const a of addrs) if (a) participants.add(a);
      latest = Math.max(latest, m.receivedAt.getTime());
      const from = norm(m.fromAddress);
      const name = m.fromName?.trim();
      if (name && (names.get(from)?.at ?? -Infinity) < m.receivedAt.getTime()) {
        names.set(from, { name, at: m.receivedAt.getTime() });
      }
    }
    if (!involved) continue;
    const w = threadStrength(new Date(latest), now);
    for (const p of participants) {
      if (p === email || isOwnAddress(p, own)) continue;
      strength.set(p, (strength.get(p) ?? 0) + w);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }

  const neighbours: NetworkNeighbor[] = [...strength.entries()].map(
    ([addr, s]) => ({
      email: addr,
      displayName: names.get(addr)?.name ?? null,
      kind: "sharedThread",
      strength: s,
      sharedThreads: counts.get(addr) ?? 0,
    }),
  );

  for (const person of input.domainPeople) {
    const addr = norm(person.email);
    if (addr === email || strength.has(addr) || isOwnAddress(addr, own)) continue;
    neighbours.push({
      email: addr,
      displayName: person.displayName ?? names.get(addr)?.name ?? null,
      kind: "domain",
      strength: person.score,
      sharedThreads: 0,
    });
  }

  return neighbours.sort(compareNeighbours);
}

export function compareNeighbours(a: NetworkNeighbor, b: NetworkNeighbor): number {
  if (a.strength !== b.strength) return b.strength - a.strength;
  if (a.kind !== b.kind) return a.kind === "sharedThread" ? -1 : 1;
  const an = (a.displayName || a.email).localeCompare(b.displayName || b.email, undefined, {
    sensitivity: "base",
  });
  return an || a.email.localeCompare(b.email);
}

const NETWORK_COLUMNS = {
  id: true,
  threadId: true,
  fromAddress: true,
  fromName: true,
  toAddresses: true,
  ccAddresses: true,
  receivedAt: true,
} as const;

/** The person's Network from the user's mail and the materialised Rank. */
export async function loadPersonNetwork(
  userId: string,
  rawEmail: string,
  own: OwnAddresses,
  now: Date = new Date(),
): Promise<NetworkNeighbor[]> {
  const email = norm(rawEmail);
  // To/Cc are stored as received (mixed case); match the raw form too, as
  // the profile does.
  const variants = [...new Set([rawEmail.trim(), email])];
  const involved = await db.message.findMany({
    where: {
      userId,
      isDraft: false,
      OR: [
        { fromAddress: { equals: email, mode: "insensitive" } },
        { toAddresses: { hasSome: variants } },
        { ccAddresses: { hasSome: variants } },
      ],
    },
    select: { id: true, threadId: true },
  });
  const threadIds = [...new Set(involved.flatMap((m) => (m.threadId ? [m.threadId] : [])))];
  const loneIds = involved.filter((m) => !m.threadId).map((m) => m.id);

  const [messages, domainPeople] = await Promise.all([
    threadIds.length + loneIds.length > 0
      ? db.message.findMany({
          where: {
            userId,
            isDraft: false,
            OR: [{ threadId: { in: threadIds } }, { id: { in: loneIds } }],
          },
          select: NETWORK_COLUMNS,
        })
      : Promise.resolve([]),
    db.personRank.findMany({
      where: { userId, domain: domainOf(email), NOT: { email } },
      select: { email: true, displayName: true, score: true },
    }),
  ]);

  const network = computeNetwork({ email, own, now, messages, domainPeople });
  if (network.length === 0) return network;

  // Sender display names win over header names for the rows.
  const senders = await db.sender.findMany({
    where: { userId, email: { in: network.map((n) => n.email) } },
    select: { email: true, displayName: true },
  });
  const byEmail = new Map<string, string>();
  for (const s of senders) {
    if (s.displayName) byEmail.set(norm(s.email), s.displayName);
  }
  return network
    .map((n) => ({ ...n, displayName: byEmail.get(n.email) ?? n.displayName }))
    .sort(compareNeighbours);
}
