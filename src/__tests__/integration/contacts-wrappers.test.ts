/**
 * Wrapper tests for the contact server actions: each one must resolve auth,
 * delegate to its shared core, and own the cache revalidation the cores
 * deliberately do not perform (plan 024 fas 1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/mail/contacts", () => ({
  createContactForUser: vi.fn(),
  renameContactForUser: vi.fn(),
  deleteContactForUser: vi.fn(),
  addContactEmailForUser: vi.fn(),
  removeContactEmailForUser: vi.fn(),
  setContactEmailLabelForUser: vi.fn(),
  setContactEmailPrimaryForUser: vi.fn(),
}));

describe("contact action wrappers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
  });

  it("createContact delegates to the core and revalidates /contacts", async () => {
    const { createContactForUser } = await import("@/lib/mail/contacts");
    vi.mocked(createContactForUser).mockResolvedValue("c1");
    const { revalidatePath } = await import("next/cache");

    const { createContact } = await import("@/actions/contacts");
    const data = { name: "Ada", emails: [{ email: "a@b.se", label: "personal" }] };
    const id = await createContact(data);

    expect(id).toBe("c1");
    expect(createContactForUser).toHaveBeenCalledWith("user-1", data);
    expect(revalidatePath).toHaveBeenCalledWith("/contacts");
  });

  it("updateContactName delegates and revalidates both contact paths", async () => {
    const { renameContactForUser } = await import("@/lib/mail/contacts");
    const { revalidatePath } = await import("next/cache");

    const { updateContactName } = await import("@/actions/contacts");
    await updateContactName("c1", "Ada K");

    expect(renameContactForUser).toHaveBeenCalledWith("user-1", "c1", "Ada K");
    expect(revalidatePath).toHaveBeenCalledWith("/contacts");
    expect(revalidatePath).toHaveBeenCalledWith("/contacts/[id]", "page");
  });

  it("deleteContact delegates and revalidates both contact paths", async () => {
    const { deleteContactForUser } = await import("@/lib/mail/contacts");
    const { revalidatePath } = await import("next/cache");

    const { deleteContact } = await import("@/actions/contacts");
    await deleteContact("c1");

    expect(deleteContactForUser).toHaveBeenCalledWith("user-1", "c1");
    expect(revalidatePath).toHaveBeenCalledWith("/contacts");
    expect(revalidatePath).toHaveBeenCalledWith("/contacts/[id]", "page");
  });

  it("without a session every wrapper throws before reaching its core", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as any);
    const cores = await import("@/lib/mail/contacts");
    const { revalidatePath } = await import("next/cache");

    const actions = await import("@/actions/contacts");
    await expect(
      actions.createContact({ name: "A", emails: [{ email: "a@b.se", label: "personal" }] }),
    ).rejects.toThrow("Unauthorized");
    await expect(actions.updateContactName("c1", "X")).rejects.toThrow(
      "Unauthorized",
    );
    await expect(actions.deleteContact("c1")).rejects.toThrow("Unauthorized");

    expect(cores.createContactForUser).not.toHaveBeenCalled();
    expect(cores.renameContactForUser).not.toHaveBeenCalled();
    expect(cores.deleteContactForUser).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
