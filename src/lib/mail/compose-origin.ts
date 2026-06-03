/**
 * Validate that a compose "from" origin is an app-internal path before
 * navigating to it, to avoid an open redirect.
 *
 * Accepts only rooted paths (a single leading "/"). Rejects:
 * - protocol-relative URLs ("//evil.com")
 * - backslash variants ("/\evil.com") — the WHATWG URL parser treats "\" as
 *   "/", so these would otherwise resolve off-site
 * - values containing control characters, which browsers strip during URL
 *   parsing and could shift how the leading-slash check is evaluated
 *
 * Returns null when the value is missing or unusable, so callers can fall back
 * to a safe default.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeInternalPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (hasControlChars(value)) return null;
  if (value[0] !== "/") return null;
  // Reject "//" (protocol-relative) and "/\" (backslash, normalized to "/").
  if (value[1] === "/" || value[1] === "\\") return null;
  return value;
}
