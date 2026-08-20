// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
});
