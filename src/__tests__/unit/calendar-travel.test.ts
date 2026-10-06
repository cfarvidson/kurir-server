import { describe, it, expect } from "vitest";
import { travelStart } from "@/lib/calendar/travel";
import {
  calendarHasTravelTime,
  travelOptions,
  travelPlace,
} from "@/components/calendar/travel-model";

describe("travelStart", () => {
  it("reads where Apple counted the travel from: X-TITLE and X-ADDRESS with its line breaks", () => {
    expect(
      travelStart([
        'X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="Storgatan 1\\n111 22 Stockholm";X-TITLE=Home:',
        "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
      ]),
    ).toEqual({ title: "Home", address: "Storgatan 1\n111 22 Stockholm" });
  });

  it("is null without a start line", () => {
    expect(travelStart(["X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC"])).toBeNull();
    expect(travelStart([])).toBeNull();
  });
});

describe("the editor's Travel time and Travel after selects", () => {
  it("offer None and the steps, 45 min among them, with the app's duration labels", () => {
    expect(travelOptions(null)).toEqual([
      { value: null, label: "None" },
      { value: 5, label: "5 min" },
      { value: 15, label: "15 min" },
      { value: 30, label: "30 min" },
      { value: 45, label: "45 min" },
      { value: 60, label: "1 h" },
      { value: 90, label: "1.5 h" },
      { value: 120, label: "2 h" },
    ]);
  });

  it("gives a length that is not a step, like Apple's computed 25 min, its own option in order", () => {
    expect(travelOptions(25).map((o) => o.label)).toEqual([
      "None",
      "5 min",
      "15 min",
      "25 min",
      "30 min",
      "45 min",
      "1 h",
      "1.5 h",
      "2 h",
    ]);
  });

  it("names the place travel starts from: its title, else the address's first line", () => {
    expect(travelPlace({ title: "Home", address: "Storgatan 1\n111 22 Stockholm" })).toBe("Home");
    expect(travelPlace({ title: null, address: "Storgatan 1\n111 22 Stockholm" })).toBe("Storgatan 1");
    expect(travelPlace({ title: null, address: null })).toBeNull();
    expect(travelPlace(null)).toBeNull();
  });

  it("is shown only for CalDAV calendars, the only ones that store travel time", () => {
    const accounts = [
      { provider: "CALDAV", calendars: [{ id: "icloud" }] },
      { provider: "GOOGLE", calendars: [{ id: "google" }] },
    ] as Parameters<typeof calendarHasTravelTime>[0];
    expect(calendarHasTravelTime(accounts, "icloud")).toBe(true);
    expect(calendarHasTravelTime(accounts, "google")).toBe(false);
  });
});
