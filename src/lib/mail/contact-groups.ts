import { z } from "zod";
import type { GroupTarget } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Contact-group cores, shared by the web server actions
 * (`@/actions/contact-groups`) and the mobile routes
 * (`/api/mobile/contact-groups`). Auth is resolved by the callers; these
 * functions take a `userId` and own everything else — ownership checks, the
 * cross-tenant email guard and the duplicate-member guard — so both surfaces
 * behave identically and can never drift.
 *
 * Like the cores in `contacts.ts`, these do NOT touch the cache layer — the
 * web wrappers own revalidatePath.
 */

/** The DB enum, enforced at the mobile edge (the web UI only offers the two
 * values, and the server action signature is typed by Prisma). */
export const groupTargetSchema = z.enum(["TO", "BCC"]);

// Verify every supplied contactEmailId belongs to the caller's contacts.
// Without this, a user could pin another tenant's ContactEmail and learn its
// address at send time (IDOR). Returns the validated ids or throws.
async function assertOwnedContactEmails(
  userId: string,
  contactEmailIds: string[],
) {
  const unique = [...new Set(contactEmailIds)];
  if (unique.length === 0) return [];

  const owned = await db.contactEmail.findMany({
    where: { id: { in: unique }, contact: { userId } },
    select: { id: true },
  });

  if (owned.length !== unique.length) {
    throw new Error("Contact email not found");
  }

  return unique;
}

async function assertOwnedGroup(userId: string, groupId: string) {
  const group = await db.contactGroup.findUnique({
    where: { id: groupId },
    select: { userId: true },
  });

  if (!group || group.userId !== userId) {
    throw new Error("Group not found");
  }
}

export async function createGroupForUser(
  userId: string,
  data: {
    name: string;
    defaultTarget?: GroupTarget;
    memberContactEmailIds?: string[];
  },
): Promise<string> {
  const name = data.name.trim();
  if (!name) {
    throw new Error("Name is required");
  }

  const memberIds = await assertOwnedContactEmails(
    userId,
    data.memberContactEmailIds ?? [],
  );

  const group = await db.$transaction(async (tx) => {
    const created = await tx.contactGroup.create({
      data: {
        name,
        defaultTarget: data.defaultTarget ?? "TO",
        userId,
      },
    });

    if (memberIds.length > 0) {
      await tx.contactGroupMember.createMany({
        data: memberIds.map((contactEmailId) => ({
          groupId: created.id,
          contactEmailId,
        })),
      });
    }

    return created;
  });

  return group.id;
}

export async function renameGroupForUser(
  userId: string,
  groupId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  await assertOwnedGroup(userId, groupId);

  await db.contactGroup.update({
    where: { id: groupId },
    data: { name: trimmed },
  });
}

export async function setGroupDefaultTargetForUser(
  userId: string,
  groupId: string,
  target: GroupTarget,
): Promise<void> {
  await assertOwnedGroup(userId, groupId);

  await db.contactGroup.update({
    where: { id: groupId },
    data: { defaultTarget: target },
  });
}

export async function deleteGroupForUser(
  userId: string,
  groupId: string,
): Promise<void> {
  await assertOwnedGroup(userId, groupId);

  // Members cascade-delete via onDelete: Cascade
  await db.contactGroup.delete({
    where: { id: groupId },
  });
}

export async function addGroupMemberForUser(
  userId: string,
  groupId: string,
  contactEmailId: string,
): Promise<void> {
  // Verify group ownership before touching the email (the guard order is
  // load-bearing: a foreign group must fail without leaking whether the
  // email id exists).
  await assertOwnedGroup(userId, groupId);

  // Verify the email belongs to the caller (cross-tenant guard)
  await assertOwnedContactEmails(userId, [contactEmailId]);

  // Skip if already a member (unique constraint also guards this)
  const existing = await db.contactGroupMember.findUnique({
    where: { groupId_contactEmailId: { groupId, contactEmailId } },
    select: { id: true },
  });

  if (!existing) {
    await db.contactGroupMember.create({
      data: { groupId, contactEmailId },
    });
  }
}

export async function removeGroupMemberForUser(
  userId: string,
  memberId: string,
): Promise<void> {
  // Verify ownership through group.userId
  const member = await db.contactGroupMember.findUnique({
    where: { id: memberId },
    include: { group: { select: { userId: true } } },
  });

  if (!member || member.group.userId !== userId) {
    throw new Error("Group member not found");
  }

  await db.contactGroupMember.delete({
    where: { id: memberId },
  });
}

// Returns the user's groups with members resolved to contact name + email.
// Used by the Contacts management UI, the compose group picker and the
// mobile list endpoint.
export async function listGroupsForUser(userId: string) {
  const groups = await db.contactGroup.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      members: {
        include: {
          contactEmail: {
            select: {
              id: true,
              email: true,
              contact: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultTarget: group.defaultTarget,
    members: group.members.map((member) => ({
      memberId: member.id,
      contactEmailId: member.contactEmailId,
      email: member.contactEmail.email,
      name: member.contactEmail.contact.name,
    })),
  }));
}
