/**
 * IANA timezone helpers shared by Settings, the MCP settings tool and the
 * browser-zone adoption flow. Validation delegates to the runtime's own
 * zone database instead of a hand-kept list.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
