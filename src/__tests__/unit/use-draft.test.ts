// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/actions/drafts", () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(),
  getAttachmentMeta: vi.fn(),
  deleteDraft: vi.fn(),
}));

import { useDraft } from "@/hooks/use-draft";

describe("useDraft", () => {
  it("reads malformed groups in the local copy as none, so restore cannot throw", async () => {
    // Node's own (disabled) localStorage global hides jsdom's.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    localStorage.setItem(
      "kurir:draft:u1:new:c1",
      JSON.stringify({
        to: "",
        subject: "Hi",
        body: "hello",
        attachmentIds: [],
        groups: "not a list",
      }),
    );
    const { result } = renderHook(() => useDraft("u1", "NEW", "c1"));
    const draft = await result.current.loadDraft();
    expect(draft).toMatchObject({ body: "hello", groups: [] });
  });
});
