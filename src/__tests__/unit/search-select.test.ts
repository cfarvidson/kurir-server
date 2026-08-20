import { describe, it, expect } from "vitest";
import { SEARCH_SELECT_COLUMNS } from "@/lib/mail/search";

describe("SEARCH_SELECT_COLUMNS", () => {
  it("selects snooze and follow-up times for list chrome", () => {
    expect(SEARCH_SELECT_COLUMNS).toContain("snoozedUntil");
    expect(SEARCH_SELECT_COLUMNS).toContain("followUpAt");
    expect(SEARCH_SELECT_COLUMNS).not.toContain("threadId");
  });
});
