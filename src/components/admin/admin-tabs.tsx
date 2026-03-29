"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = ["health", "sync", "users", "updates", "logs"] as const;
type Tab = (typeof TABS)[number];

interface AdminTabsProps {
  healthContent: React.ReactNode;
  syncContent: React.ReactNode;
  usersContent: React.ReactNode;
  updatesContent: React.ReactNode;
  logsContent: React.ReactNode;
}

export function AdminTabs({
  healthContent,
  syncContent,
  usersContent,
  updatesContent,
  logsContent,
}: AdminTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get("tab");
  const activeTab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "health";

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "health") {
        params.delete("tab");
      } else {
        params.set("tab", value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList className="w-full">
        <TabsTrigger value="health" className="flex-1">
          Health
        </TabsTrigger>
        <TabsTrigger value="sync" className="flex-1">
          Sync
        </TabsTrigger>
        <TabsTrigger value="users" className="flex-1">
          Users
        </TabsTrigger>
        <TabsTrigger value="updates" className="flex-1">
          Updates
        </TabsTrigger>
        <TabsTrigger value="logs" className="flex-1">
          Logs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="health">{healthContent}</TabsContent>
      <TabsContent value="sync">{syncContent}</TabsContent>
      <TabsContent value="users">{usersContent}</TabsContent>
      <TabsContent value="updates">{updatesContent}</TabsContent>
      <TabsContent value="logs">{logsContent}</TabsContent>
    </Tabs>
  );
}
