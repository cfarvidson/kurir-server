import { z } from "zod";
import type {
  AddedGroupState,
  ComposeGroup,
} from "@/components/mail/recipient-group-chip";
import type { RecipientTarget } from "@/lib/mail/group-expansion";

/**
 * Contact groups attached to a draft (kurir-ios#333). A draft keeps the group
 * itself, not its members' addresses, so reopening it shows the same chip in
 * the same field; members are expanded only at send time. `removedEmails` are
 * the members unchecked for this one mail, by address (member ids differ per
 * device, addresses do not). Same contract as kurir-core's DraftRecord.
 */
export const draftGroupSchema = z.object({
  groupId: z.string().min(1),
  target: z.enum(["TO", "CC", "BCC"]),
  removedEmails: z.array(z.string()).max(500).default([]),
});

/** Most groups one draft or mail takes, so a stored row stays small. */
export const MAX_DRAFT_GROUPS = 50;

export const draftGroupsSchema = z
  .array(draftGroupSchema)
  .max(MAX_DRAFT_GROUPS);

export type DraftGroup = z.infer<typeof draftGroupSchema>;

/** The stored `Draft.groups` JSON; anything malformed reads as no groups. */
export function parseDraftGroups(value: unknown): DraftGroup[] {
  const parsed = draftGroupsSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/** Field-wise, so JSONB's own key order never reads as an edit. */
export function sameDraftGroups(a: DraftGroup[], b: DraftGroup[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (g, i) =>
        g.groupId === b[i].groupId &&
        g.target === b[i].target &&
        g.removedEmails.length === b[i].removedEmails.length &&
        g.removedEmails.every((email, j) => email === b[i].removedEmails[j]),
    )
  );
}

export function draftGroupsFromCompose(added: AddedGroupState[]): DraftGroup[] {
  return added.map((s) => ({
    groupId: s.group.id,
    target: s.target.toUpperCase() as DraftGroup["target"],
    removedEmails: s.group.members
      .filter((m) => s.removedMemberIds.has(m.memberId))
      .map((m) => m.email),
  }));
}

/** Reopen a draft's groups as compose chips; a deleted group is dropped. */
export function composeGroupsFromDraft(
  saved: DraftGroup[],
  groups: ComposeGroup[],
): AddedGroupState[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  return saved.flatMap((s) => {
    const group = byId.get(s.groupId);
    if (!group) return [];
    const removed = new Set(s.removedEmails.map((e) => e.toLowerCase()));
    return [
      {
        group,
        target: s.target.toLowerCase() as RecipientTarget,
        removedMemberIds: new Set(
          group.members
            .filter((m) => removed.has(m.email.toLowerCase()))
            .map((m) => m.memberId),
        ),
      },
    ];
  });
}

/** Names of a draft's groups that still exist, in draft order. */
export function draftGroupNames(
  saved: DraftGroup[],
  groups: { id: string; name: string }[],
): string[] {
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return saved.flatMap((s) => {
    const name = byId.get(s.groupId);
    return name ? [name] : [];
  });
}

/**
 * Resolve MCP `groups` arguments: each is a group id, or else a name compared
 * case-insensitively after trimming. A name shared by several groups, or one
 * that matches nothing, is an error the agent can act on.
 */
export function resolveGroupRefs<G extends { id: string; name: string }>(
  groups: G[],
  refs: string[],
): { ok: true; groups: G[] } | { ok: false; message: string } {
  const resolved: G[] = [];
  for (const ref of refs) {
    const name = ref.trim().toLowerCase();
    const byId = groups.find((g) => g.id === ref.trim());
    const matches = byId
      ? [byId]
      : groups.filter((g) => g.name.trim().toLowerCase() === name);
    if (matches.length > 1) {
      return {
        ok: false,
        message: `Several contact groups are named "${ref.trim()}"; pass the group's id from list_contact_groups instead`,
      };
    }
    if (matches.length === 0) {
      return {
        ok: false,
        message: `No contact group with id or name "${ref.trim()}"`,
      };
    }
    if (!resolved.includes(matches[0])) resolved.push(matches[0]);
  }
  return { ok: true, groups: resolved };
}
