"use client";

import { TimeGrid } from "@/components/calendar/time-grid";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import { weekDays, type CivilDate } from "@/lib/calendar/view-time";

export function WeekView({
  anchor,
  instances,
  timezone,
  availability,
  canCreate,
  onSelectSlot,
  onEventClick,
  onTimedCommit,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
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
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-2 md:px-10">
      <TimeGrid
        days={weekDays(anchor)}
        instances={instances}
        timezone={timezone}
        availability={availability}
        showDayHeader
        canCreate={canCreate}
        onSelectSlot={onSelectSlot}
        onEventClick={onEventClick}
        onTimedCommit={onTimedCommit}
      />
    </div>
  );
}
