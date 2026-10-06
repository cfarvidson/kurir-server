// @vitest-environment jsdom
/**
 * The sidebar rail's lower corner: one button for commands and keyboard
 * shortcuts above Settings. It opens the command palette, which lists every
 * command with its shortcut and has "Keyboard shortcuts" for the full sheet.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/imbox" }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/hooks/useSync", () => ({ useSync: () => ({}) }));
vi.mock("@/components/sync/SyncStatus", () => ({
  SyncStatusIndicator: () => null,
}));
vi.mock("@/hooks/use-today-events", () => ({ useTodayEvents: () => ({ instances: [], now: new Date() }),
}));

import { Sidebar } from "@/components/layout/sidebar";

describe("Sidebar rail", () => {
  it("has one button for commands and shortcuts, with its tooltip", () => {
    render(<Sidebar />);
    const rail = screen.getByRole("navigation", { name: "Apps" });

    const button = within(rail).getByRole("button", {
      name: "Commands and shortcuts",
    });
    expect(button.getAttribute("title")).toBe("Commands and shortcuts (⌘K)");
    expect(within(rail).queryByRole("button", { name: "Shortcuts" })).toBeNull();
    expect(within(rail).queryByRole("button", { name: "Commands" })).toBeNull();
  });

  it("opens the command palette", () => {
    const opened = vi.fn();
    window.addEventListener("open-command-palette", opened);
    render(<Sidebar />);

    fireEvent.click(
      screen.getByRole("button", { name: "Commands and shortcuts" }),
    );

    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener("open-command-palette", opened);
  });
});
