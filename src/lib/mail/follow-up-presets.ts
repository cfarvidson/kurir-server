/**
 * Follow-up picker presets. Same labels and 08:00 mornings as iOS/macOS
 * `FollowUpPreset` in kurir-ios MessageListView.swift.
 */

import { morningInDays, weekdayName } from "@/lib/mail/snooze-presets";

export type FollowUpPresetId =
  | "oneDay"
  | "twoDays"
  | "threeDays"
  | "oneWeek"
  | "twoWeeks";

export type FollowUpPreset = {
  id: FollowUpPresetId;
  label: string;
  description: string;
  until: Date;
};

export function listFollowUpPresets(
  now: Date,
  timeZone: string,
): FollowUpPreset[] {
  const twoDays = morningInDays(now, timeZone, 2);
  const threeDays = morningInDays(now, timeZone, 3);
  return [
    {
      id: "oneDay",
      label: "Tomorrow",
      description: "8:00 AM",
      until: morningInDays(now, timeZone, 1),
    },
    {
      id: "twoDays",
      label: weekdayName(twoDays, timeZone),
      description: "8:00 AM",
      until: twoDays,
    },
    {
      id: "threeDays",
      label: weekdayName(threeDays, timeZone),
      description: "8:00 AM",
      until: threeDays,
    },
    {
      id: "oneWeek",
      label: "In a week",
      description: "8:00 AM",
      until: morningInDays(now, timeZone, 7),
    },
    {
      id: "twoWeeks",
      label: "In 2 weeks",
      description: "8:00 AM",
      until: morningInDays(now, timeZone, 14),
    },
  ];
}
