import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const setThreadReadState = vi.fn();
vi.mock("@/lib/mail/mutations", () => ({
  setThreadReadState: (...args: unknown[]) => setThreadReadState(...args),
}));

describe("setConversationsRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { setConversationsRead } = await import("@/actions/read-status");
    await expect(setConversationsRead(["m1"], true)).rejects.toThrow(
      "Unauthorized",
    );
    expect(setThreadReadState).not.toHaveBeenCalled();
  });

  it("calls setThreadReadState once per id with the given isRead", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    setThreadReadState.mockResolvedValue(undefined);

    const { setConversationsRead } = await import("@/actions/read-status");
    await setConversationsRead(["m1", "m2"], true);

    expect(setThreadReadState).toHaveBeenCalledTimes(2);
    expect(setThreadReadState).toHaveBeenCalledWith("user-1", "m1", true);
    expect(setThreadReadState).toHaveBeenCalledWith("user-1", "m2", true);

    const { updateTag } = await import("next/cache");
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("sidebar-counts");
  });

  it("marks unread when isRead is false", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    setThreadReadState.mockResolvedValue(undefined);

    const { setConversationsRead } = await import("@/actions/read-status");
    await setConversationsRead(["m1"], false);

    expect(setThreadReadState).toHaveBeenCalledTimes(1);
    expect(setThreadReadState).toHaveBeenCalledWith("user-1", "m1", false);
  });
});
