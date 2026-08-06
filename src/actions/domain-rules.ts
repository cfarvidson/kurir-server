"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createDomainRuleForUser,
  changeDomainRuleCategoryForUser,
  deleteDomainRuleForUser,
} from "@/lib/mail/mutations";
import { SenderCategory, SenderStatus } from "@prisma/client";

function revalidateScreenerSurfaces() {
  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
  revalidatePath("/contacts");
}

/**
 * Create a domain screening rule from a screener candidate and retroactively
 * sweep all matching pending senders (plan 033).
 */
export async function createDomainRule(
  senderId: string,
  pattern: string,
  includeSubdomains: boolean,
  status: SenderStatus,
  category?: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await createDomainRuleForUser(session.user.id, {
    senderId,
    pattern,
    includeSubdomains,
    status,
    category: category ?? null,
  });

  revalidateScreenerSurfaces();
}

export async function changeDomainRuleCategory(
  ruleId: string,
  category: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await changeDomainRuleCategoryForUser(session.user.id, ruleId, category);

  revalidateScreenerSurfaces();
}

export async function deleteDomainRule(ruleId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await deleteDomainRuleForUser(session.user.id, ruleId);

  revalidateScreenerSurfaces();
}
