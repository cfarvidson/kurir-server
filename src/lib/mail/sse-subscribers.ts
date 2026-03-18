// Single-process constraint: must be in same process as ConnectionManager.

export type MailEvent =
  | { type: "new-messages"; data: { folderId: string; count: number } }
  | { type: "flags-changed"; data: { messageId: string; flags: Record<string, boolean> } }
  | { type: "message-deleted"; data: { messageId: string } }
  | { type: "scheduled-sent"; data: { scheduledMessageId: string } }
  | { type: "scheduled-failed"; data: { scheduledMessageId: string; error: string } };

type EventCallback = (event: MailEvent) => void;

export const sseSubscribers = new Map<string, Set<EventCallback>>();

export function emitToUser(userId: string, event: MailEvent): void {
  const subscribers = sseSubscribers.get(userId);
  if (!subscribers) return;
  for (const cb of subscribers) {
    cb(event);
  }
}
