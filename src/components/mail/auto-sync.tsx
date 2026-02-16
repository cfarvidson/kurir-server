"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export function AutoSync() {
  const router = useRouter();
  const prevDataRef = useRef<unknown>(null);

  const { data } = useQuery({
    queryKey: ["mail-sync"],
    queryFn: async () => {
      const res = await fetch("/api/mail/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    const hasNew = data.results?.some(
      (r: { newMessages: number }) => r.newMessages > 0
    );
    if (hasNew) {
      router.refresh();
    }
  }, [data, router]);

  return null;
}
