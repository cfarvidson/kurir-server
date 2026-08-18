/**
 * Shared byte helpers for uploaded and IMAP-cached attachments.
 *
 * Empty stored content must be treated as missing. An empty Uint8Array is
 * truthy in JS, so `if (attachment.content)` used to serve or send a 0-byte
 * file instead of fetching the real part from IMAP.
 */

export class EmptyAttachmentDataError extends Error {
  constructor(message = "Empty file") {
    super(message);
    this.name = "EmptyAttachmentDataError";
  }
}

/** Decode MCP/client upload payload: standard base64, base64url, or data: URL. */
export function decodeUploadedAttachmentData(data: string): Buffer {
  const trimmed = data.trim();
  if (!trimmed) throw new EmptyAttachmentDataError();

  const comma = trimmed.indexOf(",");
  const payload =
    comma >= 0 && /^data:/i.test(trimmed.slice(0, comma))
      ? trimmed.slice(comma + 1)
      : trimmed;

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) throw new EmptyAttachmentDataError();
  return bytes;
}

/** Convert a Prisma Bytes value to a Buffer. Empty / missing → null. */
export function storedContentToBuffer(content: unknown): Buffer | null {
  if (!content) return null;
  if (Buffer.isBuffer(content)) {
    return content.length > 0 ? content : null;
  }
  if (content instanceof Uint8Array) {
    return content.byteLength > 0 ? Buffer.from(content) : null;
  }
  return null;
}
