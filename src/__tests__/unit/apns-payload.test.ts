import { describe, it, expect } from "vitest";
import {
  apnsAlertBody,
  apnsBackgroundBody,
  apnsNudgePushType,
} from "@/lib/push/apns";

describe("APNs payloads", () => {
  it("alert payload includes content-available and the deep-link url", () => {
    const parsed = JSON.parse(
      apnsAlertBody({
        title: "Ada",
        body: "Hello",
        url: "/imbox/m1",
        tag: "thread1",
        badge: 3,
      }),
    );
    expect(parsed.aps.alert).toEqual({ title: "Ada", body: "Hello" });
    expect(parsed.aps.sound).toBe("default");
    expect(parsed.aps["content-available"]).toBe(1);
    expect(parsed.aps["thread-id"]).toBe("thread1");
    expect(parsed.aps.badge).toBe(3);
    expect(parsed.url).toBe("/imbox/m1");
  });

  it("background payload carries read ids beside content-available", () => {
    const parsed = JSON.parse(apnsBackgroundBody({ readIds: ["m1", "m2"] }));
    expect(parsed).toEqual({
      aps: { "content-available": 1 },
      readIds: ["m1", "m2"],
    });
    expect(parsed.aps.alert).toBeUndefined();
    expect(parsed.aps.badge).toBeUndefined();
    expect(parsed.aps.sound).toBeUndefined();
  });

  it("nudge with a badge is a badge-only alert push", () => {
    const payload = { readIds: ["m1"], badge: 2 };
    const parsed = JSON.parse(apnsBackgroundBody(payload));
    expect(parsed).toEqual({
      aps: { "content-available": 1, badge: 2 },
      readIds: ["m1"],
    });
    expect(parsed.aps.alert).toBeUndefined();
    expect(parsed.aps.sound).toBeUndefined();
    expect(apnsNudgePushType(payload)).toBe("alert");
    expect(apnsNudgePushType({ readIds: ["m1"] })).toBe("background");
  });

  it("background payload omits readIds when there are none", () => {
    expect(JSON.parse(apnsBackgroundBody({}))).toEqual({
      aps: { "content-available": 1 },
    });
  });
});
