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
