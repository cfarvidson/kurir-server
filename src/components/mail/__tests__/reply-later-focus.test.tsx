// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  ReplyLaterFocus,
  type ReplyLaterItem,
} from "../reply-later-focus";

const clearReplyLater = vi.fn();
const refresh = vi.fn();

vi.mock("@/actions/reply-later", () => ({
  clearReplyLater: (...args: unknown[]) => clearReplyLater(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function makeItem(i: number): ReplyLaterItem {
  return {
    id: `m${i}`,
    subject: `Subject ${i}`,
    snippet: `Snippet ${i}`,
    fromName: `Sender ${i}`,
    fromAddress: `sender${i}@example.com`,
    receivedAt: new Date(2026, 0, i + 1),
    threadCount: 1,
  };
}

describe("ReplyLaterFocus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReplyLater.mockResolvedValue(undefined);
  });

  it("shows the caught-up empty state when there are no items", () => {
    render(<ReplyLaterFocus items={[]} />);
    expect(screen.getByText("All caught up")).toBeDefined();
  });

  it("renders the first item with correct progress", () => {
    render(<ReplyLaterFocus items={[makeItem(0), makeItem(1)]} />);
    expect(screen.getByText("1 of 2 to reply")).toBeDefined();
    expect(screen.getByText("Subject 0")).toBeDefined();
  });

  it("disables Previous on the first item and allows Skip", () => {
    render(<ReplyLaterFocus items={[makeItem(0), makeItem(1)]} />);
    const prev = screen.getByText("Previous").closest("button")!;
    expect(prev.disabled).toBe(true);

    fireEvent.click(screen.getByText("Skip").closest("button")!);
    expect(screen.getByText("2 of 2 to reply")).toBeDefined();
    expect(screen.getByText("Subject 1")).toBeDefined();
  });

  it("clears the current item on Done and advances to the next", async () => {
    render(<ReplyLaterFocus items={[makeItem(0), makeItem(1)]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Done").closest("button")!);
    });

    expect(clearReplyLater).toHaveBeenCalledWith("m0");
    expect(refresh).toHaveBeenCalled();
    // m0 is locally cleared; only m1 remains.
    expect(screen.getByText("1 of 1 to reply")).toBeDefined();
    expect(screen.getByText("Subject 1")).toBeDefined();
  });

  it("shows the empty state after the last item is cleared", async () => {
    render(<ReplyLaterFocus items={[makeItem(0)]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Done").closest("button")!);
    });

    expect(screen.getByText("All caught up")).toBeDefined();
  });
});
