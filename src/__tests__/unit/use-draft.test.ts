// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/actions/drafts", () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(),
  getAttachmentMeta: vi.fn(),
  deleteDraft: vi.fn(),
}));

import { getDraft } from "@/actions/drafts";
import { useDraft } from "@/hooks/use-draft";

const KEY = "kurir:draft:u1:new:c1";
const group = { groupId: "g1", target: "TO", removedEmails: [] };

function localCopy(fields: object) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ to: "", subject: "Hi", body: "hello", attachmentIds: [], ...fields }),
  );
}

function serverCopy(fields: object) {
  vi.mocked(getDraft).mockResolvedValue({
    to: "",
    cc: "",
    bcc: "",
    subject: "Hi",
    body: "hello",
    emailConnectionId: null,
    attachmentIds: [],
    attachments: [],
    ...fields,
  } as never);
}

async function load() {
  const { result } = renderHook(() => useDraft("u1", "NEW", "c1"));
  return result.current.loadDraft();
}

describe("useDraft", () => {
  beforeEach(() => {
    vi.mocked(getDraft).mockReset();
    // Node's own (disabled) localStorage global hides jsdom's.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("reads malformed groups in the local copy as none, so restore cannot throw", async () => {
    localCopy({ groups: "not a list" });
    expect(await load()).toMatchObject({ body: "hello", groups: [] });
  });

  it("takes a newer server copy over an older local one, so its groups are not lost", async () => {
    localCopy({ updatedAt: 1_000 });
    serverCopy({ groups: [group], updatedAt: new Date(2_000) });
    expect(await load()).toMatchObject({ groups: [group] });
  });

  it("keeps a local copy that is newer than the server's (unsaved edits)", async () => {
    localCopy({ body: "typed offline", updatedAt: 3_000 });
    serverCopy({ groups: [group], updatedAt: new Date(2_000) });
    expect(await load()).toMatchObject({ body: "typed offline", groups: [] });
  });
});
