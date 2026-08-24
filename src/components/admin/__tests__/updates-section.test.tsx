// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { UpdatesSection } from "@/components/admin/updates-section";

function status(overrides: Record<string, unknown> = {}) {
  return {
    currentVersion: "2026.29",
    updateAvailable: false,
    runningAheadOfStable: false,
    latestVersion: "2026.29",
    latestReleaseUrl:
      "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.29",
    latestChangelog: "stable changelog",
    lastUpdateCheck: "2026-08-24T00:00:00Z",
    updateMode: "notify",
    updateChannel: "stable",
    history: [],
    ...overrides,
  };
}

describe("UpdatesSection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/admin/updates") && !url.includes("/apply")) {
          return {
            ok: true,
            json: async () =>
              (globalThis as { __status?: Record<string, unknown> }).__status ??
              status(),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (globalThis as { __status?: unknown }).__status;
  });

  it("says the instance is ahead of stable instead of Up to Date", async () => {
    (globalThis as { __status?: Record<string, unknown> }).__status = status({
      currentVersion: "2026.30",
      runningAheadOfStable: true,
      latestVersion: "2026.29",
    });

    render(<UpdatesSection versionInfo={{ version: "2026.30" }} />);

    expect(await screen.findByText("Ahead of stable")).toBeTruthy();
    expect(screen.queryByText("Up to Date")).toBeNull();
    expect(
      screen.getByRole("button", { name: /reinstall stable/i }),
    ).toBeTruthy();
  });

  it("confirms that reinstalling stable does not revert migrations", async () => {
    (globalThis as { __status?: Record<string, unknown> }).__status = status({
      currentVersion: "2026.30",
      runningAheadOfStable: true,
      latestVersion: "2026.29",
    });

    render(<UpdatesSection versionInfo={{ version: "2026.30" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /reinstall stable/i }),
    );

    expect(
      screen.getByText(
        /migrations this version already applied are not reverted/i,
      ),
    ).toBeTruthy();
  });

  it("leaves an ordinary stable instance as Up to Date", async () => {
    render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

    expect(await screen.findByText("Up to Date")).toBeTruthy();
    expect(screen.queryByText("Ahead of stable")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reinstall stable/i }),
    ).toBeNull();
  });
});
