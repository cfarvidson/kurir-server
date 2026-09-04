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
import changelog from "@/../changelog.json";

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
    imageAvailable: null,
    imageCheckedAt: null,
    updateMode: "notify",
    updateChannel: "stable",
    updater: null,
    history: [],
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    createdAt: "2026-08-24T00:00:00Z",
    fromVersion: "2026.28",
    toVersion: "2026.29",
    status: "success",
    error: null,
    durationMs: 42_000,
    triggeredBy: "manual",
    completedAt: "2026-08-24T00:01:00Z",
    ...overrides,
  };
}

function setStatus(overrides: Record<string, unknown>) {
  (globalThis as { __status?: Record<string, unknown> }).__status =
    status(overrides);
}

const updateAvailable = {
  currentVersion: "2026.29",
  updateAvailable: true,
  latestVersion: "2026.30",
  latestReleaseUrl:
    "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.30",
  latestChangelog: "beta changelog",
};

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

  describe("version card", () => {
    it("says the instance is ahead of stable instead of Up to date", async () => {
      setStatus({
        currentVersion: "2026.30",
        runningAheadOfStable: true,
        latestVersion: "2026.29",
        imageAvailable: true,
      });

      render(<UpdatesSection versionInfo={{ version: "2026.30" }} />);

      expect(await screen.findByText("Ahead of stable")).toBeTruthy();
      expect(screen.queryByText("Up to date")).toBeNull();
      expect(
        screen.getByRole("button", { name: /reinstall stable/i }),
      ).toBeTruthy();
    });

    it("confirms that reinstalling stable does not revert migrations", async () => {
      setStatus({
        currentVersion: "2026.30",
        runningAheadOfStable: true,
        latestVersion: "2026.29",
        imageAvailable: true,
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

    it("leaves an ordinary stable instance as Up to date with no install button", async () => {
      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("Up to date")).toBeTruthy();
      expect(screen.queryByText("Ahead of stable")).toBeNull();
      expect(screen.queryByRole("button", { name: /update now/i })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /reinstall stable/i }),
      ).toBeNull();
    });

    it("offers Update now once the image is verified", async () => {
      setStatus({
        ...updateAvailable,
        imageAvailable: true,
        imageCheckedAt: "2026-08-24T00:00:00Z",
      });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(
        await screen.findByText("Update available: v2026.30"),
      ).toBeTruthy();
      expect(screen.getByText("Image verified")).toBeTruthy();
      const button = screen.getByRole("button", { name: /update now/i });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: /check again/i })).toBeNull();

      fireEvent.click(button);
      expect(screen.getByText("Are you sure?")).toBeTruthy();
    });

    it("disables Update now while the image is not published", async () => {
      setStatus({ ...updateAvailable, imageAvailable: false });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("v2026.30 is on its way")).toBeTruthy();
      expect(
        screen.getByText(/Docker image not published yet/),
      ).toBeTruthy();
      const button = screen.getByRole("button", { name: /update now/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(
        screen.getByTitle("Waiting for the Docker image to be published"),
      ).toBeTruthy();
    });

    it("re-checks on Check again", async () => {
      setStatus({ ...updateAvailable, imageAvailable: false });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);
      fireEvent.click(
        await screen.findByRole("button", { name: /check again/i }),
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/admin/updates/check", {
          method: "POST",
        });
      });
    });

    it("treats an unchecked image like a pending one", async () => {
      setStatus({ ...updateAvailable, imageAvailable: null });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("v2026.30 is on its way")).toBeTruthy();
      expect(
        screen.getByText("Image availability not checked yet."),
      ).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: /update now/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it("shows the running status instead of buttons during an update", async () => {
      setStatus({
        ...updateAvailable,
        imageAvailable: true,
        history: [run({ status: "pulling", toVersion: "2026.30" })],
      });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      await screen.findByText("Update available: v2026.30");
      expect(screen.queryByRole("button", { name: /update now/i })).toBeNull();
      expect(screen.getAllByText("pulling").length).toBeGreaterThan(0);
    });
  });

  describe("latest run and history", () => {
    it("renders No updates yet for an empty history", async () => {
      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);
      expect(await screen.findByText("No updates yet")).toBeTruthy();
    });

    it("shows only the latest run until expanded", async () => {
      setStatus({
        history: [
          run({ id: "a", toVersion: "2026.29" }),
          run({ id: "b", toVersion: "2026.28", fromVersion: "2026.27" }),
          run({ id: "c", toVersion: "2026.27", fromVersion: "2026.26" }),
        ],
      });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("Latest update")).toBeTruthy();
      expect(screen.getByText("2026.28 → 2026.29")).toBeTruthy();
      expect(screen.queryByText("2026.27 → 2026.28")).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Show full history (3)" }),
      );

      expect(screen.getByText("Update history")).toBeTruthy();
      expect(screen.getByText("2026.27 → 2026.28")).toBeTruthy();
      expect(screen.getByText("2026.26 → 2026.27")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(screen.queryByText("2026.27 → 2026.28")).toBeNull();
    });

    it("shows the error of a failed run inline", async () => {
      setStatus({
        history: [
          run({
            status: "failed",
            error: "failed to pull ghcr.io/x:v2026.30 - not published yet",
          }),
        ],
      });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(
        await screen.findByText(/failed to pull ghcr\.io\/x:v2026\.30/),
      ).toBeTruthy();
    });

    it("does not show an error line for a successful run", async () => {
      setStatus({ history: [run({ error: "stale error text" })] });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      await screen.findByText("2026.28 → 2026.29");
      expect(screen.queryByText("stale error text")).toBeNull();
    });
  });

  describe("what's new", () => {
    const entries = changelog as { version: string; changes: string[] }[];
    const total = entries.length;
    const firstChange = (version: string) =>
      entries.find((e) => e.version === version)!.changes[0];
    const newest = entries[0];
    // The release before 2026.29 is still on the old YYYY.MM.N scheme.
    const before29 = entries[entries.findIndex((e) => e.version === "2026.29") + 1];

    it("lists only the versions you get by updating", async () => {
      setStatus({ ...updateAvailable, imageAvailable: true });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("What's new in v2026.30")).toBeTruthy();
      expect(screen.getByText(firstChange("2026.30"))).toBeTruthy();
      expect(screen.queryByText(firstChange("2026.29"))).toBeNull();
      expect(screen.queryByText(newest.changes[0])).toBeNull();
    });

    it("spans multiple versions with a range heading", async () => {
      setStatus({
        ...updateAvailable,
        currentVersion: "2026.28",
        imageAvailable: true,
      });

      render(<UpdatesSection versionInfo={{ version: "2026.28" }} />);

      expect(
        await screen.findByText("What's new: v2026.28 → v2026.30"),
      ).toBeTruthy();
      expect(screen.getByText(firstChange("2026.30"))).toBeTruthy();
      expect(screen.getByText(firstChange("2026.29"))).toBeTruthy();
      expect(screen.queryByText(before29.changes[0])).toBeNull();
    });

    it("says you are on the latest version when up to date", async () => {
      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(
        await screen.findByText("You're on the latest version"),
      ).toBeTruthy();
      expect(screen.queryByText(newest.changes[0])).toBeNull();
    });

    it("falls back to the manifest line when the bundled changelog lacks the target", async () => {
      setStatus({
        ...updateAvailable,
        latestVersion: "2026.99",
        latestChangelog: "Something only the new image knows",
        imageAvailable: true,
      });

      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(
        await screen.findByText("What's new: v2026.29 → v2026.99"),
      ).toBeTruthy();
      expect(
        screen.getByText("Something only the new image knows"),
      ).toBeTruthy();
      expect(screen.getByText("Full notes in Release notes")).toBeTruthy();
    });

    it("expands to every version and back", async () => {
      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      fireEvent.click(
        await screen.findByRole("button", {
          name: `Show all versions (${total})`,
        }),
      );

      expect(screen.getByText("All versions")).toBeTruthy();
      expect(screen.getByText(newest.changes[0])).toBeTruthy();
      expect(screen.getByText("current")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(screen.queryByText(newest.changes[0])).toBeNull();
    });
  });

  describe("update settings", () => {
    it("keeps channel and mode controls in one card", async () => {
      render(<UpdatesSection versionInfo={{ version: "2026.29" }} />);

      expect(await screen.findByText("Update settings")).toBeTruthy();
      expect(screen.getByRole("switch", { name: "Install betas" })).toBeTruthy();
      const notify = screen.getByRole("button", { name: "Notify" });
      expect(notify.getAttribute("aria-pressed")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "Auto" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/admin/updates",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ updateMode: "auto" }),
          }),
        );
      });
    });
  });
});
