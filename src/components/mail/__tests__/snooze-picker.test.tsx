// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SnoozePicker } from "../snooze-picker";

describe("SnoozePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T09:00:00.000Z")); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the same presets as iOS/macOS, in the same order", () => {
    render(
      <SnoozePicker
        timezone="UTC"
        onSnooze={vi.fn()}
        trigger={<button type="button">Snooze</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));

    const labels = [
      "Later today",
      "Tomorrow",
      "Wednesday",
      "Thursday",
      "This weekend",
      "Next week",
      "Pick a date…",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeDefined();
    }

    const order = screen
      .getAllByRole("button")
      .map((button) =>
        labels.find((label) => button.textContent?.includes(label)),
      )
      .filter(Boolean);
    expect(order).toEqual(labels);
  });
});
