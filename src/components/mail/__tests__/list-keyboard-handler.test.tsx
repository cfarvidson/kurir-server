// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/archive", () => ({
  archiveConversation: vi.fn(() => Promise.resolve()),
  unarchiveConversation: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/actions/read-status", () => ({
  toggleReadStatus: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/components/mail/undo-toast", () => ({
  showUndoToast: vi.fn(),
}));

import {
  archiveConversation,
  unarchiveConversation,
} from "@/actions/archive";
import { ListKeyboardHandler } from "../list-keyboard-handler";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";

const thread = {
  id: "m1",
  subject: "Hello",
  snippet: null,
  fromAddress: "ada@x.y",
  fromName: "Ada",
  receivedAt: new Date(),
  isRead: true,
  hasAttachments: false,
};

describe("ListKeyboardHandler archive key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKeyboardNavigationStore.setState({ focusedIndex: 0 });
  });

  it("does not archive on e when the list has no archive or unarchive", () => {
    render(
      <ListKeyboardHandler
        threads={[thread]}
        basePath="/sent"
        showArchiveAction={false}
        showUnarchiveAction={false}
      />,
    );
    fireEvent.keyDown(window, { key: "e" });
    expect(archiveConversation).not.toHaveBeenCalled();
    expect(unarchiveConversation).not.toHaveBeenCalled();
  });

  it("unarchives on e from Archive and still drops the row", () => {
    const onArchived = vi.fn();
    render(
      <ListKeyboardHandler
        threads={[thread]}
        basePath="/archive"
        onArchived={onArchived}
        showArchiveAction={false}
        showUnarchiveAction
      />,
    );
    fireEvent.keyDown(window, { key: "e" });
    expect(unarchiveConversation).toHaveBeenCalledWith("m1");
    expect(archiveConversation).not.toHaveBeenCalled();
    expect(onArchived).toHaveBeenCalledWith("m1");
  });
});
