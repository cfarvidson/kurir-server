// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FollowUpPicker } from "../follow-up-picker";

describe("FollowUpPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the same presets as iOS/macOS, in the same order", () => {
    render(
      <FollowUpPicker
        timezone="UTC"
        onFollowUp={vi.fn()}
        trigger={<button type="button">Follow Up</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Follow Up" }));

    const labels = [
      "Tomorrow",
      "Wednesday",
      "Thursday",
      "In a week",
      "In 2 weeks",
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
