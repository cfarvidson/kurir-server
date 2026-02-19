"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshSidebarCounts } from "@/actions/sidebar";

export function SidebarRefresh() {
  const router = useRouter();
  useEffect(() => {
    refreshSidebarCounts().then(() => router.refresh());
  }, [router]);
  return null;
}
