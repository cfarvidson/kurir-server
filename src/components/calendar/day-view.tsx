"use client";

import { Filmstrip } from "@/components/calendar/filmstrip";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import type { CivilDate } from "@/lib/calendar/view-time";

export function DayView({
  anchor,
  instances,
  timezone,
  canCreate,
  onSelectSlot,
  onEventClick,
  onVisibleDayChange,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
}) {
  return (
    <Filmstrip
      anchor={anchor}
      instances={instances}
      timezone={timezone}
      canCreate={canCreate}
      onSelectSlot={onSelectSlot}
      onEventClick={onEventClick}
      onVisibleDayChange={onVisibleDayChange}
    />
  );
}
