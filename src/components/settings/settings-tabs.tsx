"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = ["account", "mail", "system"] as const;
type Tab = (typeof TABS)[number];

interface SettingsTabsProps {
  accountContent: React.ReactNode;
  mailContent: React.ReactNode;
  systemContent: React.ReactNode;
}

export function SettingsTabs({
  accountContent,
  mailContent,
  systemContent,
}: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get("tab");
  const activeTab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "account";

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "account") {
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
        <TabsTrigger value="account" className="flex-1">
          Account
        </TabsTrigger>
        <TabsTrigger value="mail" className="flex-1">
          Mail
        </TabsTrigger>
        <TabsTrigger value="system" className="flex-1">
          System
        </TabsTrigger>
      </TabsList>

      <TabsContent value="account">{accountContent}</TabsContent>
      <TabsContent value="mail">{mailContent}</TabsContent>
      <TabsContent value="system">{systemContent}</TabsContent>
    </Tabs>
  );
}
