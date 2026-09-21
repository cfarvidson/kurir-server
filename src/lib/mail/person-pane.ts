/**
 * Persistent person pane (kurir-ios#115): pure rules shared by the list
 * views, the thread view and the pane itself. Client-safe, no db.
 */

/** Rows the pane can key off: the fields every list item has. */
export interface PersonPaneRow {
  fromAddress: string;
  toAddresses?: string[];
  ccAddresses?: string[];
}

/**
 * The person a row is about: the external From, or (for sent mail) the
 * first external To / Cc. Own addresses never win. Same rule as
 * `PersonPane.personEmail` on iOS.
 */
export function personEmailFor(
  row: PersonPaneRow | null | undefined,
  ownEmails: Iterable<string>,
): string | null {
  if (!row) return null;
  const own = new Set([...ownEmails].map((e) => e.trim().toLowerCase()));
  const candidates = [
    row.fromAddress,
    ...(row.toAddresses ?? []),
    ...(row.ccAddresses ?? []),
  ];
  for (const raw of candidates) {
    const email = raw?.trim().toLowerCase();
    if (email && !own.has(email)) return email;
  }
  return null;
}

/**
 * Links only for people: a Feed or Paper Trail sender's mail is newsletters
 * and receipts, whose links are noise. No sender row (someone you only
 * wrote to) counts as a person. Same rule as `PersonPane.showsLinks` on iOS.
 */
export function showsPersonLinks(
  category: string | null | undefined,
): boolean {
  return category !== "FEED" && category !== "PAPER_TRAIL";
}

/**
 * Threads for the Recent section. A search that has not settled yet is
 * pending: the full history must not appear as if every thread matched,
 * and the previous search's hits must not stay under the new text.
 * `cap` is the idle list, which shows `limit` subject groups, not every
 * thread. The settled search shows every hit.
 */
export function visibleRecentThreads<T>(input: {
  filtering: boolean;
  settled: boolean;
  loaded: T[];
  baseline: T[];
}): { pending: boolean; threads: T[]; cap: boolean } {
  if (input.filtering && !input.settled) {
    return { pending: true, threads: [], cap: false };
  }
  if (!input.filtering) {
    return { pending: false, threads: input.baseline, cap: true };
  }
  return { pending: false, threads: input.loaded, cap: false };
}

/**
 * Lists whose pages host the pane (list, search, and their thread pages).
 * Only lists rendered through InfiniteMessageList / MessageList feed the
 * store; a page without a feeder would show a stale person.
 */
const PANE_ROUTES = [
  "/imbox",
  "/feed",
  "/paper-trail",
  "/archive",
  "/sent",
  "/snoozed",
  "/follow-up",
];

export function showsPersonPane(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PANE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** localStorage key for the collapse toggle (per browser). */
export const PERSON_PANE_COLLAPSED_KEY = "kurir:person-pane-collapsed";

/** Debounce before a focus change loads the pane. */
export const PERSON_PANE_DEBOUNCE_MS = 150;

/** A thread is direct when every From/To/Cc address is this person or us. */
export function threadIsDirect(
  thread: {
    fromAddress?: string;
    toAddresses?: string[];
    ccAddresses?: string[];
  },
  person: string,
  ownEmails: Iterable<string>,
): boolean {
  const allowed = new Set([...ownEmails].map((e) => e.trim().toLowerCase()));
  const personLower = person.toLowerCase();
  allowed.add(personLower);
  const people = [
    thread.fromAddress ?? "",
    ...(thread.toAddresses ?? []),
    ...(thread.ccAddresses ?? []),
  ]
    .map((e) => e.toLowerCase())
    .filter(Boolean);
  return people.every((p) => allowed.has(p)) && people.includes(personLower);
}

/** localStorage key prefix for the pane's disclosures ("1" = open). */
export const PERSON_PANE_SECTION_KEY_PREFIX = "kurir:person-pane-section:";

const REPLY_PREFIX = /^(re|fwd?|sv|vb|aw|wg)\s*(\[\d+\])?\s*:\s*/i;

/** Subject without reply/forward prefixes, whitespace collapsed, lowercased. */
function normalizeSubject(subject: string | null | undefined): string {
  let rest = (subject ?? "").trim();
  for (;;) {
    const next = rest.replace(REPLY_PREFIX, "");
    if (next === rest) break;
    rest = next;
  }
  return rest.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Recent in the pane: threads with the same normalized subject collapse
 * into one row. Input is newest first; each group keeps its newest thread
 * and the order of first appearance. An empty subject never groups.
 */
export function groupThreadsBySubject<T>(
  threads: T[],
  subjectOf: (thread: T) => string | null | undefined,
): { thread: T; count: number }[] {
  const groups: { thread: T; count: number }[] = [];
  const byKey = new Map<string, { thread: T; count: number }>();
  for (const thread of threads) {
    const key = normalizeSubject(subjectOf(thread));
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.count += 1;
      continue;
    }
    const group = { thread, count: 1 };
    groups.push(group);
    if (key) byKey.set(key, group);
  }
  return groups;
}

/**
 * The subject for a Recent row: a leading "<sender name>:" is dropped so
 * the part that tells rows apart survives truncation ("App Store Connect:
 * Version 2026.112" reads "Version 2026.112"). Mirrors iOS `recentSubject`.
 */
export function recentSubject(
  subject: string | null | undefined,
  senderName: string,
): string {
  const text = (subject ?? "").trim();
  const name = senderName.trim();
  if (!name || !text.toLowerCase().startsWith(`${name.toLowerCase()}:`)) {
    return text || "(no subject)";
  }
  return text.slice(name.length + 1).trim() || text;
}
