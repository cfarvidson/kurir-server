import { describe, it, expect } from "vitest";
import { apnsAlertBody, apnsBackgroundBody } from "@/lib/push/apns";

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

  it("background payload has only content-available", () => {
    const parsed = JSON.parse(apnsBackgroundBody());
    expect(parsed).toEqual({ aps: { "content-available": 1 } });
    expect(parsed.aps.alert).toBeUndefined();
    expect(parsed.aps.badge).toBeUndefined();
    expect(parsed.aps.sound).toBeUndefined();
  });
});
