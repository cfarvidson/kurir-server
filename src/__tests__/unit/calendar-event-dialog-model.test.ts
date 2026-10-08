import { describe, it, expect } from "vitest";
import { withStart } from "@/components/calendar/event-dialog-model";

const timed = {
  startDate: "2026-10-08",
  startTime: "10:05",
  endDate: "2026-10-08",
  endTime: "11:35",
  allDay: false,
};

// kurir-server#238 / kurir-ios#265: changing the start keeps the event's
// length, as in the apps.
describe("event dialog start", () => {
  it("moves the end with a new start time", () => {
    expect(withStart(timed, { startTime: "13:00" }, "Europe/Stockholm")).toEqual(
      { ...timed, startTime: "13:00", endTime: "14:30" },
    );
  });

  it("moves the end with a new start day, over the end of summer time", () => {
    expect(
      withStart(timed, { startDate: "2026-10-27" }, "Europe/Stockholm"),
    ).toEqual({
      ...timed,
      startDate: "2026-10-27",
      endDate: "2026-10-27",
    });
  });

  it("carries the end into the next day when the length runs past midnight", () => {
    expect(withStart(timed, { startTime: "23:30" }, "Europe/Stockholm")).toEqual(
      { ...timed, startTime: "23:30", endDate: "2026-10-09", endTime: "01:00" },
    );
  });

  it("keeps an all-day event's number of days", () => {
    const allDay = {
      ...timed,
      endDate: "2026-10-10",
      allDay: true,
    };
    expect(
      withStart(allDay, { startDate: "2026-10-20" }, "Europe/Stockholm"),
    ).toEqual({ ...allDay, startDate: "2026-10-20", endDate: "2026-10-22" });
  });

  it("leaves the end alone while the start field is cleared mid-edit", () => {
    expect(withStart(timed, { startTime: "" }, "Europe/Stockholm")).toEqual({
      ...timed,
      startTime: "",
    });
    expect(withStart(timed, { startDate: "" }, "Europe/Stockholm")).toEqual({
      ...timed,
      startDate: "",
    });
    // Filled in again: with no old start there is no length to keep.
    expect(
      withStart(
        { ...timed, startTime: "" },
        { startTime: "16:00" },
        "Europe/Stockholm",
      ),
    ).toEqual({ ...timed, startTime: "16:00" });
  });
});
