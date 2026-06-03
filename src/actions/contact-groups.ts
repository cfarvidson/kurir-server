"use server";

import { revalidatePath } from "next/cache";
import type { GroupTarget } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// All group mutations touch the Contacts surface (list + groups sub-route).
function revalidateGroups() {
  revalidatePath("/contacts");
  revalidatePath("/contacts/groups");
}

// Verify every supplied contactEmailId belongs to the caller's contacts.
// Without this, a user could pin another tenant's ContactEmail and learn its
// address at send time (IDOR). Returns the validated ids or throws.
async function assertOwnedContactEmails(userId: string, contactEmailIds: string[]) {
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

// ---------------------------------------------------------------------------
// 1. createGroup
// ---------------------------------------------------------------------------

export async function createGroup(data: {
  name: string;
  defaultTarget?: GroupTarget;
  memberContactEmailIds?: string[];
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;
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

  revalidateGroups();

  return group.id;
}

// ---------------------------------------------------------------------------
// 2. renameGroup
// ---------------------------------------------------------------------------

export async function renameGroup(groupId: string, name: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  const group = await db.contactGroup.findUnique({
    where: { id: groupId },
    select: { userId: true },
  });

  if (!group || group.userId !== session.user.id) {
    throw new Error("Group not found");
  }

  await db.contactGroup.update({
    where: { id: groupId },
    data: { name: trimmed },
  });

  revalidateGroups();
}

// ---------------------------------------------------------------------------
// 3. setGroupDefaultTarget
// ---------------------------------------------------------------------------

export async function setGroupDefaultTarget(
  groupId: string,
  target: GroupTarget,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const group = await db.contactGroup.findUnique({
    where: { id: groupId },
    select: { userId: true },
  });

  if (!group || group.userId !== session.user.id) {
    throw new Error("Group not found");
  }

  await db.contactGroup.update({
    where: { id: groupId },
    data: { defaultTarget: target },
  });

  revalidateGroups();
}

// ---------------------------------------------------------------------------
// 4. deleteGroup
// ---------------------------------------------------------------------------

export async function deleteGroup(groupId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const group = await db.contactGroup.findUnique({
    where: { id: groupId },
    select: { userId: true },
  });

  if (!group || group.userId !== session.user.id) {
    throw new Error("Group not found");
  }

  // Members cascade-delete via onDelete: Cascade
  await db.contactGroup.delete({
    where: { id: groupId },
  });

  revalidateGroups();
}

// ---------------------------------------------------------------------------
// 5. addGroupMember
// ---------------------------------------------------------------------------

export async function addGroupMember(groupId: string, contactEmailId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Verify group ownership
  const group = await db.contactGroup.findUnique({
    where: { id: groupId },
    select: { userId: true },
  });

  if (!group || group.userId !== userId) {
    throw new Error("Group not found");
  }

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

  revalidateGroups();
}

// ---------------------------------------------------------------------------
// 6. removeGroupMember
// ---------------------------------------------------------------------------

export async function removeGroupMember(memberId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership through group.userId
  const member = await db.contactGroupMember.findUnique({
    where: { id: memberId },
    include: { group: { select: { userId: true } } },
  });

  if (!member || member.group.userId !== session.user.id) {
    throw new Error("Group member not found");
  }

  await db.contactGroupMember.delete({
    where: { id: memberId },
  });

  revalidateGroups();
}

// ---------------------------------------------------------------------------
// 7. listGroups
// ---------------------------------------------------------------------------

// Returns the caller's groups with members resolved to contact name + email.
// Used by both the Contacts management UI and the compose group picker.
export async function listGroups() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const groups = await db.contactGroup.findMany({
    where: { userId: session.user.id },
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
