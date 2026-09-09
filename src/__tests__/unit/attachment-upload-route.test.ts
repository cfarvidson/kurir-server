/**
 * POST /api/attachments/upload — JSON chunked uploads for native clients.
 * Multipart (web) stays the single-shot path; JSON uses the same session
 * store as MCP upload_attachment so a 1.5 MB file can travel in slices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { defaultAttachmentUploadStore } from "@/lib/mail/attachment-upload-session";

vi.mock("@/lib/mobile/auth", () => ({
  getRequestUserId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    attachment: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitUploads: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  };
});

function jsonRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/attachments/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function multipartRequest(
  file: File,
  fields: Record<string, string> = {},
): NextRequest {
  const formData = new FormData();
  formData.append("file", file);
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request("http://localhost/api/attachments/upload", {
    method: "POST",
    body: formData,
  }) as unknown as NextRequest;
}

const MB = 1024 * 1024;

/**
 * Real 30/min limiter stand-in: allows the first 30 charges, refuses the
 * rest with a Retry-After. Tests count how many times a flow charged it.
 */
async function useCountingLimiter() {
  const { rateLimitUploads } = await import("@/lib/rate-limit");
  let charged = 0;
  vi.mocked(rateLimitUploads).mockImplementation(async () => {
    charged += 1;
    return charged <= 30
      ? { allowed: true, remaining: 30 - charged, retryAfter: 0 }
      : { allowed: false, remaining: 0, retryAfter: 3 };
  });
  return () => charged;
}

describe("POST /api/attachments/upload JSON chunks", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    defaultAttachmentUploadStore.clear();
    const { getRequestUserId } = await import("@/lib/mobile/auth");
    vi.mocked(getRequestUserId).mockResolvedValue("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { size: 0 },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({
      id: "up-1",
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      size: 21,
    } as never);
  });

  it("returns 401 without a session or bearer token", async () => {
    const { getRequestUserId } = await import("@/lib/mobile/auth");
    vi.mocked(getRequestUserId).mockResolvedValue(null);
    const { POST } = await import("@/app/api/attachments/upload/route");
    const res = await POST(jsonRequest({
      filename: "a.txt",
      contentType: "text/plain",
      data: Buffer.from("hi").toString("base64"),
    }));
    expect(res.status).toBe(401);
  });

  it("starts a chunked upload without persisting until done=true", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const { db } = await import("@/lib/db");
    const res = await POST(jsonRequest({
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      data: Buffer.from("%PDF-1.4 a").toString("base64"),
      done: false,
    }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      complete: false,
      receivedBytes: Buffer.byteLength("%PDF-1.4 a"),
      uploadId: expect.any(String),
    });
    expect(db.attachment.create).not.toHaveBeenCalled();
  });

  it("assembles JSON chunks and stores the full file on done=true", async () => {
    const { POST } = await import("@/app/api/attachments/upload/route");
    const { db } = await import("@/lib/db");

    const start = await POST(jsonRequest({
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      data: Buffer.from("%PDF-1.4 part-a").toString("base64"),
      done: false,
    }));
    const { uploadId } = (await start.json()) as { uploadId: string };

    const done = await POST(jsonRequest({
      uploadId,
      data: Buffer.from("-end").toString("base64"),
      done: true,
    }));
    expect(done.status).toBe(200);
    await expect(done.json()).resolves.toMatchObject({
      id: "up-1",
      complete: true,
    });

    const stored = vi.mocked(db.attachment.create).mock.calls[0][0].data
      .content as Buffer;
    expect(Buffer.from(stored).toString("utf8")).toBe("%PDF-1.4 part-a-end");
  });
});

describe("POST /api/attachments/upload rate limit per file (#175)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    defaultAttachmentUploadStore.clear();
    const { getRequestUserId } = await import("@/lib/mobile/auth");
    vi.mocked(getRequestUserId).mockResolvedValue("user-1");
    const { db } = await import("@/lib/db");
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { size: 0 },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({
      id: "up-1",
      filename: "photo.jpg",
      contentType: "image/jpeg",
      size: 40,
    } as never);
  });

  it("charges the limit once for a file sent in more than 30 chunks", async () => {
    const charged = await useCountingLimiter();
    const { POST } = await import("@/app/api/attachments/upload/route");

    const start = await POST(
      jsonRequest({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        data: Buffer.from("c").toString("base64"),
        done: false,
      }),
    );
    expect(start.status).toBe(200);
    const { uploadId } = (await start.json()) as { uploadId: string };

    for (let i = 0; i < 38; i++) {
      const res = await POST(
        jsonRequest({ uploadId, data: Buffer.from("c").toString("base64") }),
      );
      expect(res.status).toBe(200);
    }
    const done = await POST(
      jsonRequest({
        uploadId,
        data: Buffer.from("c").toString("base64"),
        done: true,
      }),
    );
    expect(done.status).toBe(200);
    await expect(done.json()).resolves.toMatchObject({ complete: true });
    expect(charged()).toBe(1);
  });

  it("still refuses the 31st new file inside a minute with 429 + Retry-After", async () => {
    await useCountingLimiter();
    const { POST } = await import("@/app/api/attachments/upload/route");

    for (let i = 0; i < 30; i++) {
      const res = await POST(
        jsonRequest({
          filename: `photo-${i}.jpg`,
          contentType: "image/jpeg",
          data: Buffer.from("c").toString("base64"),
        }),
      );
      expect(res.status).toBe(200);
    }

    const refused = await POST(
      jsonRequest({
        filename: "photo-31.jpg",
        contentType: "image/jpeg",
        data: Buffer.from("c").toString("base64"),
      }),
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("3");
  });

  it("answers 429 with Retry-After on the multipart path too", async () => {
    const { rateLimitUploads } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitUploads).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 7,
    });
    const { POST } = await import("@/app/api/attachments/upload/route");
    const res = await POST(
      multipartRequest(new File(["hi"], "a.txt", { type: "text/plain" })),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
  });
});
