// @vitest-environment jsdom
/**
 * The day view's Scheduled list gives travel time its own line under the
 * location, as the iPhone and Mac day views do in kurir-ios.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayView } from "@/components/calendar/day-view";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { DEFAULT_AVAILABILITY } from "@/lib/calendar/availability";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// The ribbon measures its width; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function climbing(
  travel: Partial<CalendarInstanceDTO> = {},
): CalendarInstanceDTO {
  return {
    eventId: "climb",
    title: "Climbing",
    startAt: "2026-10-07T16:00:00Z",
    endAt: "2026-10-07T18:00:00Z",
    isAllDay: false,
    isException: false,
    calendarId: "cal",
    color: "#8e44ad",
    calendarName: "Family",
    transparency: "busy",
    location: "Klätterverket, Hammarby Fabriksväg 25, 120 30 Stockholm",
    description: null,
    rrule: null,
    isReadOnly: false,
    ...travel,
  };
}

function renderDay(instance: CalendarInstanceDTO) {
  render(
    <DayView
      anchor={{ year: 2026, month: 10, day: 7 }}
      instances={[instance]}
      timezone="Europe/Stockholm"
      availability={DEFAULT_AVAILABILITY}
      canCreate={false}
      onSelectSlot={() => {}}
      onEventClick={() => {}}
    />,
  );
}

describe("DayView Scheduled", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows travel before and after on its own line, apart from the location", () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T08:00:00Z") });
    renderDay(
      climbing({
        travelMinutes: 25,
        travelStart: { title: "Home", address: "Storgatan 1" },
        travelAfterMinutes: 15,
      }),
    );
    expect(
      screen.getByText("25 min travel from Home · 15 min travel after"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Klätterverket, Hammarby Fabriksväg 25, 120 30 Stockholm",
      ),
    ).toBeTruthy();
  });

  it("has no travel line without travel time", () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T08:00:00Z") });
    renderDay(climbing());
    expect(screen.queryByText(/travel/)).toBeNull();
  });
});
