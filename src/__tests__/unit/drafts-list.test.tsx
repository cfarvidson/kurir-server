// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import {
  DraftsList,
  draftTypeLabel,
  draftRecipientLine,
  draftSubjectLine,
  type DraftListItem,
} from "@/components/mail/drafts-list";

const refresh = vi.fn();
const deleteDraft = vi.fn().mockResolvedValue(undefined);
const clearDraftInLocalStorage = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/actions/drafts", () => ({
  deleteDraft: (...args: unknown[]) => deleteDraft(...args),
}));

vi.mock("@/hooks/use-draft", () => ({
  clearDraftInLocalStorage: (...args: unknown[]) =>
    clearDraftInLocalStorage(...args),
}));

function fixture(overrides: Partial<DraftListItem> = {}): DraftListItem {
  return {
    type: "NEW",
    contextMessageId: "uuid-1",
    to: "ada@x.y",
    subject: "Engine notes",
    snippet: "I think we should look at the intake.",
    updatedAt: new Date("2026-08-13T10:00:00Z").toISOString(),
    href: "/compose?draft=uuid-1&from=/drafts",
    ...overrides,
  };
}

describe("draft row helpers", () => {
  it("labels types and empty fields", () => {
    expect(draftTypeLabel("NEW")).toBe("New");
    expect(draftTypeLabel("REPLY")).toBe("Reply");
    expect(draftTypeLabel("FORWARD")).toBe("Forward");
    expect(draftRecipientLine("")).toBe("No recipient");
    expect(draftRecipientLine(" ada@x.y ")).toBe("To: ada@x.y");
    expect(draftSubjectLine("")).toBe("(no subject)");
    expect(draftSubjectLine(" Hi ")).toBe("Hi");
  });
});

describe("DraftsList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the empty state", () => {
    render(<DraftsList drafts={[]} userId="user-1" />);
    expect(screen.getByText("No drafts")).toBeTruthy();
    expect(
      screen.getByText("Mail you start writing shows up here."),
    ).toBeTruthy();
  });

  it("shows a labeled Delete control on every row", () => {
    render(
      <DraftsList
        drafts={[
          fixture(),
          fixture({
            type: "REPLY",
            contextMessageId: "msg-2",
            subject: "Re: Hello",
            href: "/imbox/msg-2",
          }),
        ]}
        userId="user-1"
      />,
    );
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Reply")).toBeTruthy();
    expect(screen.getAllByText("To: ada@x.y")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: /Delete draft/i }),
    ).toHaveLength(2);
  });

  it("asks before deleting and does nothing on cancel", async () => {
    render(<DraftsList drafts={[fixture()]} userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/i }));
    expect(screen.getByText("Delete this draft?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Delete this draft?")).toBeNull();
    });
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("deletes after confirm", async () => {
    render(<DraftsList drafts={[fixture()]} userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() => {
      expect(deleteDraft).toHaveBeenCalledWith("NEW", "uuid-1");
    });
    expect(clearDraftInLocalStorage).toHaveBeenCalledWith(
      "user-1",
      "NEW",
      "uuid-1",
    );
    expect(refresh).toHaveBeenCalled();
  });
});
