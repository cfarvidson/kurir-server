import { describe, it, expect } from "vitest";
import { filterBlockedSenderRows } from "@/lib/mail/filter-blocked-senders";

describe("filterBlockedSenderRows", () => {
  it("drops every cached row whose sender.id is blocked, including other threads", () => {
    const messages = [
      { id: "m1", threadId: "t1", sender: { id: "s1" } },
      { id: "m2", threadId: "t2", sender: { id: "s1" } },
      { id: "m3", threadId: "t3", sender: { id: "s2" } },
      { id: "m4", threadId: "t4", sender: null },
    ];

    expect(
      filterBlockedSenderRows(messages, ["s1"]).map((m) => m.id),
    ).toEqual(["m3", "m4"]);
  });

  it("drops rows for every blocked sender id", () => {
    const messages = [
      { id: "m1", sender: { id: "s1" } },
      { id: "m2", sender: { id: "s2" } },
      { id: "m3", sender: { id: "s3" } },
    ];

    expect(
      filterBlockedSenderRows(messages, ["s1", "s3"]).map((m) => m.id),
    ).toEqual(["m2"]);
  });
});
