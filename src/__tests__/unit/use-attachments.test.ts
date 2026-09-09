// @vitest-environment jsdom
/**
 * Unit tests for useAttachments.
 *
 * Covers:
 * - upload() sends draftType + draftContextMessageId next to the file when
 *   the hook is given a draft ref, so the server can cap per mail (#175)
 * - upload() sends only the file when no draft ref is given
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttachments } from "@/hooks/use-attachments";

function stubUploadOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "att-1",
      filename: "photo.jpg",
      contentType: "image/jpeg",
      size: 2,
      url: "/api/attachments/att-1",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentFormData(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return init.body as FormData;
}

describe("useAttachments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the draft key next to the file when given a draft ref", async () => {
    const fetchMock = stubUploadOk();
    const { result } = renderHook(() =>
      useAttachments({ type: "REPLY", contextMessageId: "msg-1" }),
    );

    await act(async () => {
      await result.current.upload(
        new File(["hi"], "photo.jpg", { type: "image/jpeg" }),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/attachments/upload",
      expect.objectContaining({ method: "POST" }),
    );
    const form = sentFormData(fetchMock);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("draftType")).toBe("REPLY");
    expect(form.get("draftContextMessageId")).toBe("msg-1");
  });

  it("sends only the file when no draft ref is given", async () => {
    const fetchMock = stubUploadOk();
    const { result } = renderHook(() => useAttachments());

    await act(async () => {
      await result.current.upload(
        new File(["hi"], "photo.jpg", { type: "image/jpeg" }),
      );
    });

    const form = sentFormData(fetchMock);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.has("draftType")).toBe(false);
    expect(form.has("draftContextMessageId")).toBe(false);
  });
});
