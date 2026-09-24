import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    folder: {
      findUnique: vi.fn(async (args: { select: { path?: boolean } }) =>
        args.select.path ? { path: "INBOX" } : { emailConnectionId: "c1" },
      ),
    },
  },
}));
vi.mock("@/lib/mail/imap-client", () => ({ withImapConnection: vi.fn() }));

describe("pushFlagsToImap", () => {
  it("stores the flag over a short-lived connection, not the IDLE client", async () => {
    // The IDLE client holds its INBOX lock for its whole lifetime, so a lock
    // requested on it never resolves and the flag never reached IMAP.
    const lock = { release: vi.fn() };
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(lock),
      messageFlagsAdd: vi.fn().mockResolvedValue(true),
    };
    const { withImapConnection } = await import("@/lib/mail/imap-client");
    vi.mocked(withImapConnection).mockImplementation(
      async (_id, fn) => fn(client as never) as never,
    );

    const { pushFlagsToImap } = await import("@/lib/mail/flag-push");
    await pushFlagsToImap("user-1", [{ uid: 7, folderId: "f1" }], "\\Seen", "add");

    expect(withImapConnection).toHaveBeenCalledWith("c1", expect.any(Function));
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(client.messageFlagsAdd).toHaveBeenCalledWith("7", ["\\Seen"], {
      uid: true,
    });
    expect(lock.release).toHaveBeenCalled();
  });
});
