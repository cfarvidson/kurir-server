"use server";

import { revalidateTag } from "next/cache";

export async function refreshSidebarCounts() {
  revalidateTag("sidebar-counts");
}
