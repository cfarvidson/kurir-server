// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  ToastShell,
  TOAST_SHELL_CLASS,
  TOAST_SHELL_STYLE,
} from "@/components/ui/toast-config";

describe("ToastShell", () => {
  it("wraps children in the shared toast chrome so custom toasts match standard toasts", () => {
    const { container, getByText } = render(
      <ToastShell>
        <span>Sending…</span>
      </ToastShell>,
    );

    // Children render inside the shell.
    expect(getByText("Sending…")).toBeDefined();

    // The shell root carries the same chrome tokens that standard toasts get
    // from the <Toaster> toastOptions.className (bg-card, border, shadow).
    const shell = container.firstChild as HTMLElement;
    for (const token of TOAST_SHELL_CLASS.split(" ")) {
      expect(shell.className).toContain(token);
    }
  });

  it("applies the shared CSS custom properties that bind toast colors to theme tokens", () => {
    const { container } = render(
      <ToastShell>
        <span>x</span>
      </ToastShell>,
    );

    const shell = container.firstChild as HTMLElement;
    for (const [prop, value] of Object.entries(TOAST_SHELL_STYLE)) {
      expect(shell.style.getPropertyValue(prop)).toBe(value);
    }
  });

  it("merges an extra className without dropping the shared chrome", () => {
    const { container } = render(
      <ToastShell className="custom-extra">
        <span>x</span>
      </ToastShell>,
    );

    const shell = container.firstChild as HTMLElement;
    expect(shell.className).toContain("custom-extra");
    for (const token of TOAST_SHELL_CLASS.split(" ")) {
      expect(shell.className).toContain(token);
    }
  });
});
