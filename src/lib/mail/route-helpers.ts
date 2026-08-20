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

export function fileOpenHref(
  message: {
    id: string;
    isInImbox: boolean;
    isInFeed: boolean;
    isInPaperTrail: boolean;
    isArchived: boolean;
  } | null,
): string | null {
  if (!message) return null;
  return `${getThreadRoute(message)}/${message.id}`;
}
