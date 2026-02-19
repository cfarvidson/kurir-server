"use client";

import { useEffect } from "react";
import { refreshSidebarCounts } from "@/actions/sidebar";

export function SidebarRefresh() {
  useEffect(() => {
    refreshSidebarCounts();
  }, []);
  return null;
}
