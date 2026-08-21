"use client";

import { TimeGrid } from "@/components/calendar/time-grid";
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
  onTimedCommit,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onTimedCommit: (
    event: CalendarInstanceDTO,
    startAt: Date,
    endAt: Date,
  ) => void;
}) {
  return (
    <TimeGrid
      days={[anchor]}
      instances={instances}
      timezone={timezone}
      showDayHeader={false}
      canCreate={canCreate}
      onSelectSlot={onSelectSlot}
      onEventClick={onEventClick}
      onTimedCommit={onTimedCommit}
    />
  );
}
