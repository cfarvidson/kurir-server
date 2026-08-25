"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createSubjectRuleForUser,
  changeSubjectRuleCategoryForUser,
  deleteSubjectRuleForUser,
} from "@/lib/mail/mutations";
import {
  SenderCategory,
  SenderStatus,
  SubjectRuleScope,
} from "@prisma/client";

// Unlike the domain-rule twin this skips /contacts: subject rules never
// approve a sender, so they never create contacts.
function revalidateScreenerSurfaces() {
  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
}

/**
 * Create a subject screening rule from a message's sender (kurir-ios#48).
 */
export async function createSubjectRule(
  senderId: string,
  scope: SubjectRuleScope,
  scopeValue: string,
  pattern: string,
  status: SenderStatus,
  category?: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await createSubjectRuleForUser(session.user.id, {
    senderId,
    scope,
    scopeValue,
    pattern,
    status,
    category: category ?? null,
  });

  revalidateScreenerSurfaces();
}

export async function changeSubjectRuleCategory(
  ruleId: string,
  category: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await changeSubjectRuleCategoryForUser(session.user.id, ruleId, category);

  revalidateScreenerSurfaces();
}

export async function deleteSubjectRule(ruleId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await deleteSubjectRuleForUser(session.user.id, ruleId);

  revalidateScreenerSurfaces();
}
