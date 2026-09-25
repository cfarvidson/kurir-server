// @vitest-environment jsdom
/**
 * CopyableAddress - a person's email address, selectable, with a copy
 * button that writes it to the clipboard and flips to "Copied".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyableAddress } from "@/components/mail/copyable-address";

describe("CopyableAddress", () => {
  it("shows the address and copies it on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyableAddress address="anna@corp-a.example" />);
    expect(screen.getByText("anna@corp-a.example")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Copy email address"));
    expect(writeText).toHaveBeenCalledWith("anna@corp-a.example");
    await waitFor(() => expect(screen.getByLabelText("Copied")).toBeTruthy());
  });
});
