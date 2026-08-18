import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyUploadChunk,
  createAttachmentUploadStore,
  AttachmentUploadError,
  MAX_UPLOAD_BYTES,
} from "@/lib/mail/attachment-upload-session";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("applyUploadChunk", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a single call as a complete upload (backward compatible)", () => {
    const store = createAttachmentUploadStore();
    const result = applyUploadChunk(store, {
      userId: "u1",
      filename: "note.txt",
      contentType: "text/plain",
      data: b64("hello"),
    });

    expect(result).toEqual({
      complete: true,
      filename: "note.txt",
      contentType: "text/plain",
      receivedBytes: 5,
      bytes: expect.any(Buffer),
    });
    expect(result.complete && result.bytes.toString("utf8")).toBe("hello");
  });

  it("assembles a file sent in multiple chunks without requiring one huge base64 payload", () => {
    const store = createAttachmentUploadStore();
    const first = applyUploadChunk(store, {
      userId: "u1",
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      data: b64("%PDF-1.4 part-one-"),
      done: false,
    });

    expect(first).toMatchObject({
      complete: false,
      receivedBytes: Buffer.byteLength("%PDF-1.4 part-one-"),
    });
    if (first.complete) throw new Error("expected incomplete first chunk");

    const second = applyUploadChunk(store, {
      userId: "u1",
      uploadId: first.uploadId,
      data: b64("part-two"),
      done: false,
    });
    expect(second).toMatchObject({
      complete: false,
      uploadId: first.uploadId,
    });

    const last = applyUploadChunk(store, {
      userId: "u1",
      uploadId: first.uploadId,
      data: b64("-end"),
      done: true,
    });

    expect(last.complete).toBe(true);
    if (!last.complete) return;
    expect(last.filename).toBe("felix-cv.pdf");
    expect(last.contentType).toBe("application/pdf");
    expect(last.bytes.toString("utf8")).toBe("%PDF-1.4 part-one-part-two-end");
    expect(last.receivedBytes).toBe(last.bytes.length);
  });

  it("finalizes a session with done=true and no extra data", () => {
    const store = createAttachmentUploadStore();
    const first = applyUploadChunk(store, {
      userId: "u1",
      filename: "a.bin",
      contentType: "application/octet-stream",
      data: b64("abc"),
      done: false,
    });
    if (first.complete) throw new Error("expected incomplete");

    const done = applyUploadChunk(store, {
      userId: "u1",
      uploadId: first.uploadId,
      done: true,
    });

    expect(done.complete).toBe(true);
    if (!done.complete) return;
    expect(done.bytes.toString("utf8")).toBe("abc");
  });

  it("rejects a first chunk that is missing filename or contentType", () => {
    const store = createAttachmentUploadStore();
    expect(() =>
      applyUploadChunk(store, {
        userId: "u1",
        contentType: "text/plain",
        data: b64("x"),
      }),
    ).toThrow(AttachmentUploadError);

    expect(() =>
      applyUploadChunk(store, {
        userId: "u1",
        filename: "x.txt",
        data: b64("x"),
      }),
    ).toThrow(AttachmentUploadError);
  });

  it("rejects an unknown or foreign uploadId instead of appending", () => {
    const store = createAttachmentUploadStore();
    const first = applyUploadChunk(store, {
      userId: "u1",
      filename: "a.txt",
      contentType: "text/plain",
      data: b64("mine"),
      done: false,
    });
    if (first.complete) throw new Error("expected incomplete");

    expect(() =>
      applyUploadChunk(store, {
        userId: "u2",
        uploadId: first.uploadId,
        data: b64("stolen"),
        done: true,
      }),
    ).toThrow(/not found/i);

    expect(() =>
      applyUploadChunk(store, {
        userId: "u1",
        uploadId: "does-not-exist",
        data: b64("x"),
        done: true,
      }),
    ).toThrow(/not found/i);
  });

  it("rejects a session that would exceed the 5MB decoded limit", () => {
    const store = createAttachmentUploadStore();
    const first = applyUploadChunk(store, {
      userId: "u1",
      filename: "big.bin",
      contentType: "application/octet-stream",
      data: Buffer.alloc(MAX_UPLOAD_BYTES - 10).toString("base64"),
      done: false,
    });
    if (first.complete) throw new Error("expected incomplete");

    expect(() =>
      applyUploadChunk(store, {
        userId: "u1",
        uploadId: first.uploadId,
        data: Buffer.alloc(20).toString("base64"),
        done: false,
      }),
    ).toThrow(/too large/i);
  });

  it("forgets expired sessions so a late chunk cannot complete them", () => {
    vi.useFakeTimers();
    const store = createAttachmentUploadStore({ now: () => Date.now() });
    const first = applyUploadChunk(store, {
      userId: "u1",
      filename: "late.txt",
      contentType: "text/plain",
      data: b64("start"),
      done: false,
    });
    if (first.complete) throw new Error("expected incomplete");

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(() =>
      applyUploadChunk(store, {
        userId: "u1",
        uploadId: first.uploadId,
        data: b64("late"),
        done: true,
      }),
    ).toThrow(/not found/i);
  });

  it("counts in-progress session bytes toward a user's pending total", () => {
    const store = createAttachmentUploadStore();
    applyUploadChunk(store, {
      userId: "u1",
      filename: "a.txt",
      contentType: "text/plain",
      data: b64("aaaa"),
      done: false,
    });
    applyUploadChunk(store, {
      userId: "u2",
      filename: "b.txt",
      contentType: "text/plain",
      data: b64("bbbbbb"),
      done: false,
    });

    expect(store.pendingBytes("u1")).toBe(4);
    expect(store.pendingBytes("u2")).toBe(6);
  });
});
