import { describe, it, expect, vi, beforeEach } from "vitest";

const { dnsMocks, pinnedMocks } = vi.hoisted(() => ({
  dnsMocks: { lookup: vi.fn() },
  pinnedMocks: { fetchPinned: vi.fn() },
}));

vi.mock("node:dns/promises", () => ({
  lookup: dnsMocks.lookup,
}));

vi.mock("@/lib/calendar/ics-pinned", () => ({
  fetchPinned: pinnedMocks.fetchPinned,
}));

import { canonicalizeIcsUrl, fetchIcsFeed } from "@/lib/calendar/ics-url";

describe("canonicalizeIcsUrl", () => {
  it("rewrites webcal, webcals and http to https and strips trailing slashes", () => {
    expect(canonicalizeIcsUrl("webcal://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("webcals://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("http://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("  https://example.com/holidays.ics/  ")).toBe(
      "https://example.com/holidays.ics",
    );
  });

  it("keeps query tokens so a Google secret address still works", () => {
    expect(
      canonicalizeIcsUrl(
        "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-token/basic.ics",
      ),
    ).toBe(
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-token/basic.ics",
    );
  });

  it("rejects userinfo so this path stays the no-auth door", () => {
    expect(() =>
      canonicalizeIcsUrl("https://user:pass@example.com/cal.ics"),
    ).toThrow(/no login/i);
  });

  it("rejects non-http schemes", () => {
    expect(() => canonicalizeIcsUrl("file:///tmp/cal.ics")).toThrow(
      /not a calendar url/i,
    );
    expect(() => canonicalizeIcsUrl("javascript:alert(1)")).toThrow(
      /not a calendar url/i,
    );
  });
});

describe("fetchIcsFeed DNS pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a hostname that resolves to loopback before connecting", async () => {
    dnsMocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await expect(
      fetchIcsFeed("https://evil.example/cal.ics"),
    ).rejects.toThrow(/not allowed/i);

    expect(pinnedMocks.fetchPinned).not.toHaveBeenCalled();
  });

  it("connects to the validated address, not a second DNS lookup", async () => {
    dnsMocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
    pinnedMocks.fetchPinned.mockResolvedValue(
      new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", {
        status: 200,
        headers: { "content-type": "text/calendar" },
      }),
    );

    await fetchIcsFeed("https://calendar.example/holidays.ics");

    expect(pinnedMocks.fetchPinned).toHaveBeenCalledTimes(1);
    const [url, ip] = pinnedMocks.fetchPinned.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).hostname).toBe("calendar.example");
    expect(ip).toBe("93.184.216.34");
  });

  it("does not fetch a redirect onto a blocked host", async () => {
    dnsMocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
    pinnedMocks.fetchPinned.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/cal.ics" },
      }),
    );

    await expect(
      fetchIcsFeed("https://calendar.example/holidays.ics"),
    ).rejects.toThrow(/not allowed/i);

    expect(pinnedMocks.fetchPinned).toHaveBeenCalledTimes(1);
  });
});
