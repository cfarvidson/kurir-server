import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    oauth: {
      google: { clientId: "google-client", clientSecret: "google-secret" },
      microsoft: { clientId: "ms-client", clientSecret: "ms-secret" },
    },
  }),
}));

describe("calendar OAuth scopes", () => {
  it("Google includes calendar scope and not Gmail", async () => {
    const { GOOGLE_CALENDAR_SCOPES, buildCalendarAuthorizationUrl } =
      await import("@/lib/calendar/oauth");

    expect(GOOGLE_CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar",
    );
    expect(GOOGLE_CALENDAR_SCOPES).not.toContain("https://mail.google.com/");
    expect(GOOGLE_CALENDAR_SCOPES).toEqual(
      expect.arrayContaining(["openid", "email"]),
    );

    const url = buildCalendarAuthorizationUrl(
      "GOOGLE",
      "https://kurir.example/api/calendar/oauth/callback",
      "state",
    );
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("https://www.googleapis.com/auth/calendar");
    expect(scope).not.toContain("https://mail.google.com/");
    expect(parsed.searchParams.get("client_id")).toBe("google-client");
  });

  it("Microsoft includes Calendars.ReadWrite and not IMAP", async () => {
    const { MICROSOFT_CALENDAR_SCOPES, buildCalendarAuthorizationUrl } =
      await import("@/lib/calendar/oauth");

    expect(MICROSOFT_CALENDAR_SCOPES).toContain("Calendars.ReadWrite");
    expect(MICROSOFT_CALENDAR_SCOPES).not.toContain("IMAP.AccessAsUser.All");
    expect(MICROSOFT_CALENDAR_SCOPES).toEqual(
      expect.arrayContaining(["openid", "email", "offline_access"]),
    );

    const url = buildCalendarAuthorizationUrl(
      "MICROSOFT",
      "https://kurir.example/api/calendar/oauth/callback",
      "state",
    );
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("Calendars.ReadWrite");
    expect(scope).not.toContain("IMAP.AccessAsUser.All");
    expect(parsed.searchParams.get("client_id")).toBe("ms-client");
  });
});

describe("safeCalendarOAuthRedirect", () => {
  it("accepts a same-origin path", async () => {
    const { safeCalendarOAuthRedirect } = await import("@/lib/calendar/oauth");
    expect(safeCalendarOAuthRedirect("/calendar")).toBe("/calendar");
    expect(safeCalendarOAuthRedirect("/settings?tab=calendar")).toBe(
      "/settings?tab=calendar",
    );
  });

  it("rejects protocol-relative and backslash WHATWG bypasses", async () => {
    const { safeCalendarOAuthRedirect } = await import("@/lib/calendar/oauth");
    const fallback = "/settings?tab=calendar";
    expect(safeCalendarOAuthRedirect("//evil.com")).toBe(fallback);
    expect(safeCalendarOAuthRedirect("/\\evil.com")).toBe(fallback);
    expect(safeCalendarOAuthRedirect("/\\/evil.com")).toBe(fallback);
    expect(safeCalendarOAuthRedirect("\\\\evil.com")).toBe(fallback);
    expect(safeCalendarOAuthRedirect("https://evil.com")).toBe(fallback);
  });
});
