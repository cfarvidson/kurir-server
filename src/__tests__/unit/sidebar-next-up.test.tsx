// @vitest-environment jsdom
/**
 * The sidebar's Next up card: a click on the card opens the calendar, and
 * a meeting with a link gets Join, the same button as the calendar's Next
 * up card. Mirrors the Mac sidebar card in kurir-ios.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

const today = vi.hoisted(() => ({
  instances: [] as CalendarInstanceDTO[],
  now: new Date("2026-09-25T07:10:00Z"),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/imbox" }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/hooks/useSync", () => ({ useSync: () => ({}) }));
vi.mock("@/components/sync/SyncStatus", () => ({
  SyncStatusIndicator: () => null,
}));
vi.mock("@/hooks/use-today-events", () => ({ useTodayEvents: () => today }));

import { Sidebar } from "@/components/layout/sidebar";

function standup(description: string | null): CalendarInstanceDTO {
  return {
    eventId: "standup",
    title: "Standup",
    startAt: "2026-09-25T07:30:00Z",
    endAt: "2026-09-25T07:45:00Z",
    isAllDay: false,
    isException: false,
    calendarId: "cal",
    color: "#2f6fb5",
    calendarName: "Work",
    transparency: "busy",
    location: null,
    description,
    rrule: null,
    isReadOnly: false,
  };
}

describe("Sidebar Next up card", () => {
  beforeEach(() => {
    today.instances = [];
    today.now = new Date("2026-09-25T07:10:00Z");
  });

  it("has Join for a meeting with a link, beside the link to the calendar", () => {
    today.instances = [standup("https://meet.example.com/standup")];
    render(<Sidebar timezone="Europe/Stockholm" />);

    const join = screen.getByRole("link", { name: "Join" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/standup");
    expect(join.getAttribute("target")).toBe("_blank");

    const card = screen.getByRole("link", { name: /Next up.*Standup/ });
    expect(card.getAttribute("href")).toBe("/calendar");
    expect(card.contains(join)).toBe(false);
  });

  it("gives the meeting's title up to three lines, not one", () => {
    today.instances = [
      {
        ...standup(null),
        title: "Media Supply Tech sync with the partner team",
      },
    ];
    render(<Sidebar timezone="Europe/Stockholm" />);

    const title = screen.getByText(
      "Media Supply Tech sync with the partner team",
    );
    expect(title.className).toMatch(/\bline-clamp-3\b/);
    expect(title.className).not.toMatch(/\btruncate\b/);
  });

  it("lists the rest of today under the card, each opening the calendar", () => {
    today.instances = [
      standup(null),
      {
        ...standup(null),
        eventId: "review",
        title: "Design review",
        startAt: "2026-09-25T09:00:00Z",
        endAt: "2026-09-25T10:00:00Z",
      },
    ];
    render(<Sidebar timezone="Europe/Stockholm" />);

    const row = screen.getByRole("link", { name: /11:00.*Design review/ });
    expect(row.getAttribute("href")).toBe("/calendar");
  });

  it("has no Join when the meeting has no link", () => {
    today.instances = [standup(null)];
    render(<Sidebar timezone="Europe/Stockholm" />);

    expect(screen.queryByRole("link", { name: "Join" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Next up.*Standup/ }).getAttribute("href"),
    ).toBe("/calendar");
  });

  function later(n: number): CalendarInstanceDTO[] {
    return Array.from({ length: n }, (_, i) => ({
      ...standup(null),
      eventId: `later-${i}`,
      title: `Later ${i}`,
      startAt: `2026-09-25T1${i}:00:00Z`,
      endAt: `2026-09-25T1${i}:30:00Z`,
    }));
  }

  it("lists four of the rest of today and counts the others", () => {
    today.instances = [standup(null), ...later(6)];
    render(<Sidebar timezone="Europe/Stockholm" />);

    expect(screen.getAllByRole("link", { name: /Later \d/ })).toHaveLength(4);
    const more = screen.getByRole("link", { name: "2 more today" });
    expect(more.getAttribute("href")).toBe("/calendar");
  });

  it("has no more-today line with four left", () => {
    today.instances = [standup(null), ...later(4)];
    render(<Sidebar timezone="Europe/Stockholm" />);

    expect(screen.getAllByRole("link", { name: /Later \d/ })).toHaveLength(4);
    expect(screen.queryByText(/more today/)).toBeNull();
  });

  it("shows Today and the all-day events when nothing timed is left", () => {
    today.now = new Date("2026-09-25T20:00:00Z");
    today.instances = [
      standup(null),
      {
        ...standup(null),
        eventId: "holiday",
        title: "Holiday",
        startAt: "2026-09-25T00:00:00Z",
        endAt: "2026-09-26T00:00:00Z",
        isAllDay: true,
      },
    ];
    render(<Sidebar timezone="Europe/Stockholm" />);

    expect(screen.queryByText(/Next up/)).toBeNull();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByRole("link", { name: /All day.*Holiday/ })).toBeTruthy();
  });

  it("shows no card when nothing is left today", () => {
    today.now = new Date("2026-09-25T20:00:00Z");
    today.instances = [standup(null)];
    render(<Sidebar timezone="Europe/Stockholm" />);

    expect(screen.queryByText(/Next up/)).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
  });
});
