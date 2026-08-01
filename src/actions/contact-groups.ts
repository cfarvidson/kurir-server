"use server";

import { revalidatePath } from "next/cache";
import type { GroupTarget } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  addGroupMemberForUser,
  createGroupForUser,
  deleteGroupForUser,
  listGroupsForUser,
  removeGroupMemberForUser,
  renameGroupForUser,
  setGroupDefaultTargetForUser,
} from "@/lib/mail/contact-groups";

// Thin wrappers around the cores in `@/lib/mail/contact-groups` (shared with
// the mobile routes): resolve auth, delegate, revalidate. All group mutations
// touch the Contacts surface (list + groups sub-route).

function revalidateGroups() {
  revalidatePath("/contacts");
  revalidatePath("/contacts/groups");
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function createGroup(data: {
  name: string;
  defaultTarget?: GroupTarget;
  memberContactEmailIds?: string[];
}) {
  const userId = await requireUserId();
  const groupId = await createGroupForUser(userId, data);
  revalidateGroups();
  return groupId;
}

export async function renameGroup(groupId: string, name: string) {
  const userId = await requireUserId();
  await renameGroupForUser(userId, groupId, name);
  revalidateGroups();
}

export async function setGroupDefaultTarget(
  groupId: string,
  target: GroupTarget,
) {
  const userId = await requireUserId();
  await setGroupDefaultTargetForUser(userId, groupId, target);
  revalidateGroups();
}

export async function deleteGroup(groupId: string) {
  const userId = await requireUserId();
  await deleteGroupForUser(userId, groupId);
  revalidateGroups();
}

export async function addGroupMember(groupId: string, contactEmailId: string) {
  const userId = await requireUserId();
  await addGroupMemberForUser(userId, groupId, contactEmailId);
  revalidateGroups();
}

export async function removeGroupMember(memberId: string) {
  const userId = await requireUserId();
  await removeGroupMemberForUser(userId, memberId);
  revalidateGroups();
}

export async function listGroups() {
  const userId = await requireUserId();
  return listGroupsForUser(userId);
}
