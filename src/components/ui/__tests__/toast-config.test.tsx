// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import {
  ToastShell,
  TOAST_SHELL_CLASS,
  TOAST_SHELL_STYLE,
  TOAST_UNSTYLED_RESET_CLASS,
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

describe("TOAST_UNSTYLED_RESET_CLASS", () => {
  // sonner applies TOAST_SHELL_CLASS to the outer <li> of every toast, even
  // `unstyled` custom ones. The reset class is passed as the custom toast's
  // className to cancel the container-edge chrome (border, background, shadow)
  // so only the inner ToastShell draws a visible edge. These assertions tie the
  // two constants together so the reset can't silently drift from the chrome.
  it("cancels every container-edge chrome utility that TOAST_SHELL_CLASS applies", () => {
    const reset = TOAST_UNSTYLED_RESET_CLASS.split(" ");

    const edgeOverrides: Record<string, string> = {
      border: "!border-0", // border width
      "bg-card": "!bg-transparent", // background
      "shadow-lg": "!shadow-none", // shadow
    };

    for (const [chromeToken, expectedOverride] of Object.entries(
      edgeOverrides,
    )) {
      // The chrome token must actually be present in the shared chrome class,
      // otherwise the override guards against nothing.
      expect(TOAST_SHELL_CLASS.split(" ")).toContain(chromeToken);
      // ...and the reset must override it with an important modifier so it wins
      // regardless of stylesheet source order.
      expect(reset).toContain(expectedOverride);
    }
  });
});

describe("custom unstyled toast call sites", () => {
  // Regression guard: sonner applies TOAST_SHELL_CLASS to every toast's outer
  // <li>, including `unstyled` custom ones, so each custom toast must pass
  // TOAST_UNSTYLED_RESET_CLASS to cancel that inherited chrome. A site that sets
  // `unstyled: true` but forgets the reset reintroduces the faint extra border.
  // (This is exactly how a third call site was missed during the original fix.)
  it("every `unstyled: true` toast option object also passes TOAST_UNSTYLED_RESET_CLASS", () => {
    // __dirname is src/components/ui/__tests__; walk up to src/.
    const srcDir = join(__dirname, "..", "..", "..");

    const tsxFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
          tsxFiles.push(full);
        }
      }
    };
    walk(srcDir);

    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("unstyled: true")) continue;
      // The reset constant must be wired into this file's toast options.
      if (!src.includes("TOAST_UNSTYLED_RESET_CLASS")) {
        offenders.push(file.slice(srcDir.length + 1));
      }
    }

    expect(
      offenders,
      `These files create an \`unstyled: true\` toast but never reference ` +
        `TOAST_UNSTYLED_RESET_CLASS, so the outer <li> keeps the inherited ` +
        `border/bg/shadow chrome: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
