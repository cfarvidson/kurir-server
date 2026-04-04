"use client";

import { useState, useEffect } from "react";

interface BadgeCountProps {
  screenerCount: number;
  imboxUnreadCount: number;
  feedUnreadCount: number;
  paperTrailUnreadCount: number;
  scheduledCount: number;
  followUpCount: number;
}

export function useBadgeCounts({
  screenerCount,
  imboxUnreadCount,
  feedUnreadCount,
  paperTrailUnreadCount,
  scheduledCount,
  followUpCount,
}: BadgeCountProps) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});

  // Listen for optimistic badge updates
  useEffect(() => {
    const handler = (e: Event) => {
      const { key, delta } = (e as CustomEvent).detail;
      setDeltas((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + delta }));
    };
    window.addEventListener("badge-count-update", handler);
    return () => window.removeEventListener("badge-count-update", handler);
  }, []);

  // Reset deltas when server props change (router.refresh() completed)
  useEffect(() => {
    setDeltas({});
  }, [
    screenerCount,
    imboxUnreadCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    scheduledCount,
    followUpCount,
  ]);

  return {
    imbox: Math.max(0, imboxUnreadCount + (deltas.imbox ?? 0)),
    screener: Math.max(0, screenerCount + (deltas.screener ?? 0)),
    feed: Math.max(0, feedUnreadCount + (deltas.feed ?? 0)),
    paperTrail: Math.max(0, paperTrailUnreadCount + (deltas.paperTrail ?? 0)),
    scheduled: Math.max(0, scheduledCount + (deltas.scheduled ?? 0)),
    followUp: Math.max(0, followUpCount + (deltas.followUp ?? 0)),
  };
}
