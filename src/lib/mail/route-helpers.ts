export function getThreadRoute(thread: {
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
}): string {
  if (thread.isInImbox) return "/imbox";
  if (thread.isInFeed) return "/feed";
  if (thread.isInPaperTrail) return "/paper-trail";
  if (thread.isArchived) return "/archive";
  return "/imbox"; // fallback
}
