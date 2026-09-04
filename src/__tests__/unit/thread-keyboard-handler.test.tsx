// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ThreadKeyboardHandler } from "@/components/mail/thread-keyboard-handler";

const intentionalBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/navigation", () => ({
  intentionalBack: (...args: unknown[]) => intentionalBack(...args),
}));

vi.mock("@/stores/keyboard-navigation-store", () => ({
  useKeyboardNavigationStore: () => ({
    threadIds: ["m1"],
    basePath: "/imbox",
    setFocusedIndex: vi.fn(),
  }),
}));

describe("ThreadKeyboardHandler mouse back", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("closes the thread on mouse button 3", () => {
    render(<ThreadKeyboardHandler messageId="m1" returnPath="/imbox" />);
    fireEvent.mouseUp(window, { button: 3 });
    expect(intentionalBack).toHaveBeenCalledWith("/imbox");
  });

  it("ignores other mouse buttons", () => {
    render(<ThreadKeyboardHandler messageId="m1" returnPath="/imbox" />);
    fireEvent.mouseUp(window, { button: 0 });
    fireEvent.mouseUp(window, { button: 4 });
    expect(intentionalBack).not.toHaveBeenCalled();
  });

  it("bare r replies; Cmd+R does not", () => {
    const onReply = vi.fn();
    window.addEventListener("keyboard-reply", onReply);
    render(<ThreadKeyboardHandler messageId="m1" returnPath="/imbox" />);

    fireEvent.keyDown(window, { key: "r", metaKey: true });
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(onReply).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "r" });
    expect(onReply).toHaveBeenCalledTimes(1);

    window.removeEventListener("keyboard-reply", onReply);
  });
});
