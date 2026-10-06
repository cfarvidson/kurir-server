import { describe, it, expect } from "vitest";
import ICAL from "ical.js";
import {
  NO_TRAVEL,
  appleTravelLines,
  nextTravel,
  readTravel,
  travelStart,
  writeTravel,
  type Travel,
} from "@/lib/calendar/travel";
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

const START =
  'X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="Storgatan 1\\n111 22 Stockholm";X-TITLE=Home:';
const ADVISORY = "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC";

describe("nextTravel", () => {
  const current: Travel = {
    travelMinutes: 25,
    travelExtra: [START, ADVISORY],
    travelAfterMinutes: 15,
  };

  // Before: omitted keeps it, the same length keeps every line, a new length
  // drops the start line, None removes every line.
  const before = {
    omitted: [undefined, 25, [START, ADVISORY]],
    unchanged: [25, 25, [START, ADVISORY]],
    set: [40, 40, [ADVISORY]],
    none: [null, null, []],
  } as const;
  // After: omitted and unchanged keep it, set writes it, None removes it.
  const after = {
    omitted: [undefined, 15],
    unchanged: [15, 15],
    set: [30, 30],
    none: [null, null],
  } as const;

  for (const [
    beforeCase,
    [minutes, travelMinutes, travelExtra],
  ] of Object.entries(before)) {
    for (const [
      afterCase,
      [afterMinutes, travelAfterMinutes],
    ] of Object.entries(after)) {
      it(`before ${beforeCase}, after ${afterCase}`, () => {
        const input: Parameters<typeof nextTravel>[1] = { isAllDay: false };
        if (minutes !== undefined) input.travelMinutes = minutes;
        if (afterMinutes !== undefined) input.travelAfterMinutes = afterMinutes;
        expect(nextTravel(current, input)).toEqual({
          travelMinutes,
          travelExtra: [...travelExtra],
          travelAfterMinutes,
        });
      });
    }
  }

  it("removes a stray start line on None even when there was no length to compare", () => {
    expect(
      nextTravel(
        { travelMinutes: null, travelExtra: [START], travelAfterMinutes: null },
        { travelMinutes: null, isAllDay: false },
      ),
    ).toEqual(NO_TRAVEL);
    expect(
      nextTravel(
        { travelMinutes: null, travelExtra: [START], travelAfterMinutes: 20 },
        { travelMinutes: 0, isAllDay: false },
      ),
    ).toEqual({ ...NO_TRAVEL, travelAfterMinutes: 20 });
  });

  it("gives an all-day event neither side, whatever the input says", () => {
    expect(
      nextTravel(current, {
        travelMinutes: 30,
        travelAfterMinutes: 30,
        isAllDay: true,
      }),
    ).toEqual(NO_TRAVEL);
  });
});

function vevent(lines: string[]): ICAL.Component {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:t1",
    "DTSTART:20261009T080000Z",
    "DTEND:20261009T090000Z",
    ...lines,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent("vevent")!;
}

describe("writeTravel", () => {
  it("writes when only travel after differs", () => {
    const event = vevent([
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT25M",
      "X-KURIR-TRAVEL-AFTER;VALUE=DURATION:PT15M",
    ]);

    writeTravel(event, { ...readTravel(event), travelAfterMinutes: 30 });

    expect(readTravel(event)).toEqual({
      travelMinutes: 25,
      travelExtra: [],
      travelAfterMinutes: 30,
    });
  });
});

describe("appleTravelLines", () => {
  const wrap = (lines: string[]) =>
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:t1",
      ...lines,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  const body = (ics: string) => ics.split("\r\n").slice(3, -2);

  it("unfolds a folded travel line, rewrites it in Apple's form and folds it again", () => {
    const folded = [
      'X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="Storgatan 1\\n111 22',
      // The fold's own space comes first; the address's space follows it.
      '  Stockholm";X-TITLE=Home:',
    ];

    const out = appleTravelLines(wrap(folded));

    expect(out.replace(/\r\n /g, "")).toContain(START);
    expect(body(out).every((line) => line.length <= 75)).toBe(true);
  });

  it("matches the property names whatever their case", () => {
    const out = appleTravelLines(
      wrap([
        "x-apple-travel-duration;value=duration:PT30M",
        "X-Kurir-Travel-After;VALUE=DURATION:PT1H",
      ]),
    );

    expect(body(out)).toEqual([
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M",
      "X-KURIR-TRAVEL-AFTER;VALUE=DURATION:PT1H",
    ]);
  });

  it("rewrites several travel lines on one VEVENT and leaves the others as they were", () => {
    const out = appleTravelLines(
      wrap([
        "SUMMARY:Dentist",
        "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M",
        START,
        ADVISORY,
        "X-KURIR-TRAVEL-AFTER:PT90M",
        "LOCATION:Folktandvården",
      ]),
    );

    expect(body(out).map((line) => line)).toEqual([
      "SUMMARY:Dentist",
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M",
      ...ICAL.helpers.foldline(START).split("\r\n"),
      ADVISORY,
      "X-KURIR-TRAVEL-AFTER;VALUE=DURATION:PT1H30M",
      "LOCATION:Folktandvården",
    ]);
  });

  it("handles a resource with only Kurir's line: rebuilt from its minutes, or left out when it has none", () => {
    expect(
      body(appleTravelLines(wrap(["X-KURIR-TRAVEL-AFTER;X-NOTE=x:PT20M"]))),
    ).toEqual(["X-KURIR-TRAVEL-AFTER;VALUE=DURATION:PT20M"]);
    expect(body(appleTravelLines(wrap(["X-KURIR-TRAVEL-AFTER:soon"])))).toEqual(
      [],
    );
  });
});
