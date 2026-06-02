/**
 * Pure group-expansion logic for the compose recipient area.
 *
 * A group added while composing is tracked separately from the typed To/Cc/Bcc
 * strings (see compose-client). At send time it is expanded into its members'
 * bare email addresses, routed to the field the chip targets. Members removed
 * for this one send (`removedMemberIds`) are excluded, and members whose
 * contact/email was deleted are simply absent from `members` (the caller
 * resolves live members), satisfying the "silently dropped" requirement.
 *
 * Addresses are deduped case-insensitively across all buckets with first-seen
 * precedence (group order, then member order), so a person added via two chips
 * is never sent the same mail twice. Output addresses are bare (no display
 * name), so they pass `parseRecipients` when merged with the typed fields.
 */

export type RecipientTarget = "to" | "cc" | "bcc";

export interface GroupMemberAddress {
  memberId: string;
  email: string;
}

export interface AddedGroup {
  groupId: string;
  target: RecipientTarget;
  /** Live members of the group (deleted contacts already excluded by caller). */
  members: GroupMemberAddress[];
  /** Member ids removed for this one send only. */
  removedMemberIds?: Iterable<string>;
}

export interface ExpandedGroups {
  to: string[];
  cc: string[];
  bcc: string[];
}

export function expandGroups(groups: AddedGroup[]): ExpandedGroups {
  const result: ExpandedGroups = { to: [], cc: [], bcc: [] };
  const seen = new Set<string>();

  for (const group of groups) {
    const removed = new Set(group.removedMemberIds ?? []);

    for (const member of group.members) {
      if (removed.has(member.memberId)) continue;

      const address = member.email.trim();
      if (!address) continue;

      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      result[group.target].push(address);
    }
  }

  return result;
}

/**
 * Count of addresses a group contributes after per-send removals.
 * Drives the chip's live count label (e.g. "Family (4)").
 */
export function liveMemberCount(group: AddedGroup): number {
  const removed = new Set(group.removedMemberIds ?? []);
  return group.members.filter((m) => !removed.has(m.memberId)).length;
}
