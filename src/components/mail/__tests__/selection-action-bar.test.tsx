// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/actions/archive", () => ({
  archiveConversations: vi.fn(),
  unarchiveConversations: vi.fn(),
}));
vi.mock("@/actions/snooze", () => ({
  snoozeConversations: vi.fn(),
}));
vi.mock("@/actions/read-status", () => ({
  setConversationsRead: vi.fn(),
  toggleReadStatus: vi.fn(),
}));
vi.mock("@/actions/senders", () => ({
  rejectSenders: vi.fn(),
}));

import { rejectSenders } from "@/actions/senders";
import { SelectionActionBar } from "../selection-action-bar";

describe("SelectionActionBar", () => {
  it("shows Read and Block sender when those flags are on", () => {
    render(
      <SelectionActionBar
        selectedMessageIds={["m1"]}
        onComplete={() => {}}
        onQueryInvalidate={() => {}}
        showReadAction
        showBlockAction
        readLabel="Read"
      />,
    );
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Block sender")).toBeDefined();
    expect(screen.queryByText("Snooze")).toBeNull();
  });

  it("notifies onBlocked with sender ids, not selected message ids", async () => {
    vi.mocked(rejectSenders).mockResolvedValue(undefined);
    const onQueryInvalidate = vi.fn();
    const onBlocked = vi.fn();

    render(
      <SelectionActionBar
        selectedMessageIds={["m1"]}
        selectedRows={[
          {
            isRead: false,
            senderId: "s1",
            fromAddress: "ada@x.y",
            senderName: "Ada",
          },
        ]}
        onComplete={() => {}}
        onQueryInvalidate={onQueryInvalidate}
        onBlocked={onBlocked}
        showBlockAction
      />,
    );

    fireEvent.click(screen.getByText("Block sender"));

    await waitFor(() => expect(onBlocked).toHaveBeenCalledWith(["s1"]));
    expect(onQueryInvalidate).not.toHaveBeenCalled();
  });
});
