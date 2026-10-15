// @vitest-environment jsdom
/**
 * kurir-ios#332: "Kulturföreningen" was saved as "Kultur föreningen". The name
 * field turns autocorrect off like the apps' `.autocorrectionDisabled()`, so
 * WebKit's autocorrect cannot split a Swedish compound word. Two more tests
 * check that the editor sends the name to the save actions unchanged, on
 * create and on rename.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const createGroup = vi.fn().mockResolvedValue({ id: "g1" });
const renameGroup = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/contact-groups", () => ({
  createGroup: (...args: unknown[]) => createGroup(...args),
  renameGroup: (...args: unknown[]) => renameGroup(...args),
  setGroupDefaultTarget: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
}));

import {
  GroupEditor,
  type EditorGroup,
} from "@/components/contacts/group-editor";

afterEach(() => {
  cleanup();
  createGroup.mockClear();
  renameGroup.mockClear();
});

function renderEditor(group?: EditorGroup) {
  render(
    <GroupEditor
      open
      onOpenChange={vi.fn()}
      group={group}
      contactEmailOptions={[]}
    />,
  );
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

    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Kulturföreningen" }),
      ),
    );
  });

  it("renames a group to a name with å/ä/ö as typed", async () => {
    const field = renderEditor({
      id: "g1",
      name: "Kultur föreningen",
      defaultTarget: "TO",
      members: [],
    });
    fireEvent.change(field, { target: { value: "Kulturföreningen" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(renameGroup).toHaveBeenCalledWith("g1", "Kulturföreningen"),
    );
  });
});
