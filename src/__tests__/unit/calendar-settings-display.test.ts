import { describe, it, expect } from "vitest";
import {
  calendarLastSyncLabel,
  calendarProviderLabel,
  calendarReconnectHref,
} from "@/lib/calendar/settings-display";

describe("calendarProviderLabel", () => {
  it("uses Outlook for Microsoft", () => {
    expect(calendarProviderLabel("GOOGLE")).toBe("Google");
    expect(calendarProviderLabel("MICROSOFT")).toBe("Outlook");
    expect(calendarProviderLabel("CALDAV")).toBe("CalDAV");
    expect(calendarProviderLabel("ICS")).toBe("Calendar URL");
  });
});

describe("calendarReconnectHref", () => {
  it("sends OAuth reconnect back to the settings calendar tab", () => {
    expect(calendarReconnectHref("GOOGLE")).toBe(
      "/api/calendar/oauth/start?provider=google&redirect=%2Fsettings%3Ftab%3Dcalendar",
    );
    expect(calendarReconnectHref("MICROSOFT")).toBe(
      "/api/calendar/oauth/start?provider=microsoft&redirect=%2Fsettings%3Ftab%3Dcalendar",
    );
  });

  it("returns null for CalDAV and ICS", () => {
    expect(calendarReconnectHref("CALDAV")).toBeNull();
    expect(calendarReconnectHref("ICS")).toBeNull();
  });
});

describe("calendarLastSyncLabel", () => {
  it("prefers syncing over a stored timestamp", () => {
    expect(
      calendarLastSyncLabel("2026-08-20T12:00:00.000Z", true),
    ).toBe("Syncing...");
  });

  it("says not yet synced when there is no timestamp", () => {
    expect(calendarLastSyncLabel(null, false)).toBe("Not yet synced");
  });
});
