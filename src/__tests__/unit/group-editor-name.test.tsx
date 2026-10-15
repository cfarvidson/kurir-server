// @vitest-environment jsdom
/**
 * A group keeps its name exactly as typed (kurir-ios#332): "Kulturföreningen"
 * was saved as "Kultur föreningen". The name field turns autocorrect off like
 * the apps' `.autocorrectionDisabled()`, so the browser's autocorrect cannot
 * split a Swedish compound word, and what is typed is what gets saved.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const createGroup = vi.fn().mockResolvedValue({ id: "g1" });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/contact-groups", () => ({
  createGroup: (...args: unknown[]) => createGroup(...args),
  renameGroup: vi.fn(),
  setGroupDefaultTarget: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
}));

import { GroupEditor } from "@/components/contacts/group-editor";

afterEach(() => {
  cleanup();
  createGroup.mockClear();
});

function renderEditor() {
  render(<GroupEditor open onOpenChange={vi.fn()} contactEmailOptions={[]} />);
  return screen.getByLabelText("Name");
}

describe("GroupEditor name", () => {
  it("turns autocorrect and spellcheck off", () => {
    const field = renderEditor();
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  // A guard: nothing between the field and the save action rewrites the name.
  it("saves a name with å/ä/ö as typed", async () => {
    const field = renderEditor();
    fireEvent.change(field, { target: { value: "Kulturföreningen" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createGroup).toHaveBeenCalled());
    expect(createGroup.mock.calls[0][0].name).toBe("Kulturföreningen");
  });
});
