"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateBadgePreferences } from "@/actions/badge-preferences";
import type { BadgePreferences } from "@/components/layout/navigation";

const badges: {
  key: keyof BadgePreferences;
  label: string;
  description: string;
}[] = [
  {
    key: "showImboxBadge",
    label: "Imbox",
    description: "Unread message count",
  },
  {
    key: "showScreenerBadge",
    label: "Screener",
    description: "Pending sender count",
  },
  {
    key: "showFeedBadge",
    label: "The Feed",
    description: "Unread message count",
  },
  {
    key: "showPaperTrailBadge",
    label: "Paper Trail",
    description: "Unread message count",
  },
  {
    key: "showFollowUpBadge",
    label: "Follow Up",
    description: "Active reminder count",
  },
  {
    key: "showScheduledBadge",
    label: "Scheduled",
    description: "Pending message count",
  },
];

export function BadgePreferencesSettings({
  initialPrefs,
}: {
  initialPrefs: BadgePreferences;
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (key: keyof BadgePreferences, checked: boolean) => {
    const previous = prefs[key];
    setPrefs((prev) => ({ ...prev, [key]: checked }));
    startTransition(async () => {
      try {
        await updateBadgePreferences({ [key]: checked });
      } catch {
        setPrefs((prev) => ({ ...prev, [key]: previous }));
        toast.error("Failed to update badge preferences");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Choose which navigation items show count badges.
      </p>
      {badges.map((badge) => (
        <div key={badge.key} className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{badge.label}</p>
            <p className="text-xs text-muted-foreground">
              {badge.description}
            </p>
          </div>
          <Switch
            checked={prefs[badge.key]}
            onCheckedChange={(checked) => handleToggle(badge.key, checked)}
            disabled={isPending}
          />
        </div>
      ))}
    </div>
  );
}
