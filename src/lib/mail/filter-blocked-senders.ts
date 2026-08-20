/** Drop list-cache rows whose sender was just blocked. */

export function filterBlockedSenderRows<
  T extends { sender?: { id?: string } | null },
>(messages: T[], senderIds: string[]): T[] {
  if (senderIds.length === 0) return messages;
  const blocked = new Set(senderIds);
  return messages.filter((message) => {
    const id = message.sender?.id;
    return !id || !blocked.has(id);
  });
}
