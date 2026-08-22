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
  onTimedCommit,
  onVisibleDayChange,
  scrollToRequest,
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
  onVisibleDayChange?: (day: CivilDate) => void;
  scrollToRequest?: { key: string; nonce: number };
}) {
  return (
    <Filmstrip
      anchor={anchor}
      instances={instances}
      timezone={timezone}
      canCreate={canCreate}
      onSelectSlot={onSelectSlot}
      onEventClick={onEventClick}
      onTimedCommit={onTimedCommit}
      onVisibleDayChange={onVisibleDayChange}
      scrollToRequest={scrollToRequest}
    />
  );
}
