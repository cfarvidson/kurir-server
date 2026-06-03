/**
 * Resolve a stored recipient address to a contact display name.
 *
 * The map is built server-side from a single batched ContactEmail lookup
 * (keyed by lowercased address). When an address has no matching contact —
 * e.g. the contact was deleted — the raw address is returned unchanged, so
 * the recipient is always shown accurately even when the friendly name is
 * gone.
 */
export type RecipientNameMap = Record<string, string>;

export function resolveRecipientName(
  address: string,
  nameMap: RecipientNameMap,
): string {
  const name = nameMap[address.trim().toLowerCase()];
  return name && name.trim() ? name : address;
}
