"use server";

import { revalidatePath, revalidateTag } from "next/cache";

export async function refreshSidebarCounts() {
  revalidateTag("sidebar-counts");
  // Also revalidate list pages so read status updates on back navigation
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/snoozed");
  revalidatePath("/archive");
  revalidatePath("/sent");
}
