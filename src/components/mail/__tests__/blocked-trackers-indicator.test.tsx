// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BlockedTrackersIndicator } from "../blocked-trackers-indicator";

describe("BlockedTrackersIndicator", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<BlockedTrackersIndicator count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the singular label for one tracker", () => {
    const { container } = render(<BlockedTrackersIndicator count={1} />);
    expect(container.textContent).toContain("1 tracker blocked");
  });

  it("renders the plural label for multiple trackers", () => {
    const { container } = render(<BlockedTrackersIndicator count={3} />);
    expect(container.textContent).toContain("3 trackers blocked");
  });
});
