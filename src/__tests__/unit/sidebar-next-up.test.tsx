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
  });

  it("has Join for a meeting with a link, beside the link to the calendar", () => {
    today.instances = [standup("https://meet.example.com/standup")];
    render(<Sidebar />);

    const join = screen.getByRole("link", { name: "Join" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/standup");
    expect(join.getAttribute("target")).toBe("_blank");

    const card = screen.getByRole("link", { name: /Next up.*Standup/ });
    expect(card.getAttribute("href")).toBe("/calendar");
    expect(card.contains(join)).toBe(false);
  });

  it("has no Join when the meeting has no link", () => {
    today.instances = [standup(null)];
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Join" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Next up.*Standup/ }).getAttribute("href"),
    ).toBe("/calendar");
  });
});
