/**
 * Validate that a compose "from" origin is an app-internal path before
 * navigating to it, to avoid an open redirect.
 *
 * Accepts only paths that start with a single "/" (not "//", which is
 * protocol-relative and would navigate off-site). Returns null when the value
 * is missing or unusable, so callers can fall back to a safe default.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
