// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ThreadNoteEditor } from "@/components/mail/thread-note-editor";

vi.mock("@/actions/thread-notes", () => ({
  saveThreadNote: vi.fn(),
}));

describe("ThreadNoteEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stays collapsed until the user asks to add a note", () => {
    render(<ThreadNoteEditor threadId="t1" initialBody="" />);
    expect(screen.getByText("Add a private note")).toBeTruthy();
    expect(screen.queryByLabelText("Private note")).toBeNull();

    fireEvent.click(screen.getByText("Add a private note"));
    expect(screen.getByLabelText("Private note")).toBeTruthy();
  });

  it("opens with the saved note and never mentions sending", () => {
    render(
      <ThreadNoteEditor threadId="t1" initialBody="Follow up Tuesday" />,
    );
    const field = screen.getByLabelText("Private note") as HTMLTextAreaElement;
    expect(field.value).toBe("Follow up Tuesday");
    expect(field.placeholder).toMatch(/never sent/i);
  });
});
