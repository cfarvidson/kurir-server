import { describe, it, expect } from "vitest";
import {
  navigation,
  railSectionFor,
  railSections,
} from "@/components/layout/navigation";

describe("railSections", () => {
  it("puts every navigation item in exactly one rail section", () => {
    const placed = railSections.flatMap((section) =>
      section.groups.flatMap((group) => group.items.map((item) => item.href)),
    );
    expect([...placed].sort()).toEqual(
      navigation.map((item) => item.href).sort(),
    );
  });

  it("orders the rail Mail, Screener, Calendar, Contacts, Files", () => {
    expect(railSections.map((section) => section.name)).toEqual([
      "Mail",
      "Screener",
      "Calendar",
      "Contacts",
      "Files",
    ]);
  });
});

describe("railSectionFor", () => {
  it.each([
    ["/imbox", "mail"],
    ["/reply-later", "mail"],
    ["/archive", "mail"],
    ["/screener", "screener"],
    ["/filters", "screener"],
    ["/calendar", "calendar"],
    ["/calendar/month", "calendar"],
    ["/contacts/groups", "contacts"],
    ["/files", "files"],
    ["/settings", "mail"],
    ["/compose", "mail"],
  ])("%s shows the %s panel", (pathname, id) => {
    expect(railSectionFor(pathname).id).toBe(id);
  });
});
