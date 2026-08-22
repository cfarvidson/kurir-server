"use client";

import { TimeGrid } from "@/components/calendar/time-grid";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { weekDays, type CivilDate } from "@/lib/calendar/view-time";

export function WeekView({
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
      days={weekDays(anchor)}
      instances={instances}
      timezone={timezone}
      showDayHeader
      canCreate={canCreate}
      onSelectSlot={onSelectSlot}
      onEventClick={onEventClick}
      onTimedCommit={onTimedCommit}
    />
  );
}
