// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/actions/drafts", () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(),
  getAttachmentMeta: vi.fn(),
  deleteDraft: vi.fn(),
}));

import { getDraft, saveDraft } from "@/actions/drafts";
import { useDraft } from "@/hooks/use-draft";

const KEY = "kurir:draft:u1:new:c1";
const group = {
  groupId: "g1",
  target: "TO" as const,
  removedEmails: [] as string[],
};
const content = { to: "", subject: "Hi", body: "hello", attachmentIds: [] };

function localCopy(fields: object) {
  localStorage.setItem(KEY, JSON.stringify({ ...content, ...fields }));
}

function readLocal() {
  return JSON.parse(localStorage.getItem(KEY) ?? "null");
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
    vi.mocked(saveDraft).mockReset();
    // Node's own (disabled) localStorage global hides jsdom's.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads malformed groups in the local copy as none, so restore cannot throw", async () => {
    localCopy({ groups: "not a list" });
    expect(await load()).toMatchObject({ body: "hello", groups: [] });
  });

  it("takes a server copy saved after the local copy's last save, whatever the browser clock says", async () => {
    // The browser clock is far ahead; only server times are compared.
    localCopy({ serverUpdatedAt: 1_000, updatedAt: 9e15 });
    serverCopy({ groups: [group], updatedAt: new Date(2_000) });
    expect(await load()).toMatchObject({ groups: [group] });
  });

  it("keeps a local copy with edits not yet saved", async () => {
    localCopy({ body: "typed offline", serverUpdatedAt: 1_000, unsaved: true });
    serverCopy({ groups: [group], updatedAt: new Date(2_000) });
    expect(await load()).toMatchObject({ body: "typed offline", groups: [] });
  });

  it("falls back to the local copy when the server read fails", async () => {
    localCopy({ body: "local", serverUpdatedAt: 1_000 });
    vi.mocked(getDraft).mockRejectedValue(new Error("offline"));
    expect(await load()).toMatchObject({ body: "local" });
  });

  it("marks the local copy unsaved until the server answers, then records the server's time", async () => {
    vi.useFakeTimers();
    let answer!: (row: unknown) => void;
    vi.mocked(saveDraft).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as never,
    );
    const { result, unmount } = renderHook(() => useDraft("u1", "NEW", "c1"));

    act(() => result.current.saveDraft({ ...content, groups: [group] }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(readLocal()).toMatchObject({ unsaved: true });

    await act(async () => answer({ updatedAt: new Date(5_000) }));
    expect(readLocal()).toMatchObject({
      groups: [group],
      serverUpdatedAt: 5_000,
      unsaved: false,
    });

    // Closing the composer after the save leaves the copy marked saved.
    unmount();
    expect(readLocal()).toMatchObject({ unsaved: false });
  });
});
