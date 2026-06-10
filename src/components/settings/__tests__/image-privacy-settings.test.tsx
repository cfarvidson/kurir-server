// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const setRemoteImagePolicy = vi.fn();
const toastError = vi.fn();

vi.mock("@/actions/image-policy", () => ({
  setRemoteImagePolicy: (...args: unknown[]) => setRemoteImagePolicy(...args),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import { ImagePrivacySettings } from "../image-privacy-settings";

describe("ImagePrivacySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the initial policy as selected", () => {
    render(<ImagePrivacySettings initialPolicy="BLOCK_ALL" />);
    const selected = screen.getByRole("radio", { checked: true });
    expect(selected.textContent).toContain("Block all remote images");
  });

  it("calls setRemoteImagePolicy with the chosen policy", async () => {
    setRemoteImagePolicy.mockResolvedValue(undefined);
    render(<ImagePrivacySettings initialPolicy="BLOCK_ALL" />);

    const option = screen.getByRole("radio", {
      name: /Load images, block trackers/i,
    });
    await act(async () => {
      option.click();
    });

    expect(setRemoteImagePolicy).toHaveBeenCalledWith("BLOCK_TRACKERS");
  });

  it("reverts selection and shows a toast on failure", async () => {
    setRemoteImagePolicy.mockRejectedValue(new Error("boom"));
    render(<ImagePrivacySettings initialPolicy="BLOCK_ALL" />);

    const option = screen.getByRole("radio", {
      name: /Load all remote images/i,
    });
    await act(async () => {
      option.click();
    });

    expect(toastError).toHaveBeenCalled();
    // Selection reverted to the original.
    expect(
      screen.getByRole("radio", { checked: true }).textContent,
    ).toContain("Block all remote images");
  });

  it("does nothing when the already-selected option is clicked", async () => {
    render(<ImagePrivacySettings initialPolicy="BLOCK_TRACKERS" />);
    const option = screen.getByRole("radio", {
      name: /Load images, block trackers/i,
    });
    await act(async () => {
      option.click();
    });
    expect(setRemoteImagePolicy).not.toHaveBeenCalled();
  });
});
