import { randomBytes } from "crypto";
import {
  decodeUploadedAttachmentData,
  EmptyAttachmentDataError,
} from "@/lib/mail/attachment-bytes";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SESSION_TTL_MS = 15 * 60 * 1000;

export class AttachmentUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentUploadError";
  }
}

export interface UploadChunkInput {
  userId: string;
  filename?: string;
  contentType?: string;
  data?: string;
  uploadId?: string;
  done?: boolean;
}

export type UploadChunkResult =
  | {
      complete: false;
      uploadId: string;
      receivedBytes: number;
    }
  | {
      complete: true;
      uploadId?: string;
      filename: string;
      contentType: string;
      receivedBytes: number;
      bytes: Buffer;
    };

interface SessionEntry {
  userId: string;
  filename: string;
  contentType: string;
  parts: Buffer[];
  receivedBytes: number;
  expiresAt: number;
}

export interface AttachmentUploadStore {
  pendingBytes(userId: string): number;
  clear(): void;
}

interface StoreOptions {
  now?: () => number;
  ttlMs?: number;
  id?: () => string;
}

interface InternalStore extends AttachmentUploadStore {
  get(userId: string, uploadId: string): SessionEntry | null;
  put(id: string, entry: SessionEntry): void;
  delete(id: string): void;
  prune(now: number): void;
}

export function createAttachmentUploadStore(
  options: StoreOptions = {},
): AttachmentUploadStore {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const sessions = new Map<string, SessionEntry>();

  const store: InternalStore = {
    prune(at: number) {
      for (const [id, entry] of sessions) {
        if (entry.expiresAt <= at) sessions.delete(id);
      }
    },
    get(userId: string, uploadId: string) {
      const at = now();
      store.prune(at);
      const entry = sessions.get(uploadId);
      if (!entry || entry.userId !== userId) return null;
      if (entry.expiresAt <= at) {
        sessions.delete(uploadId);
        return null;
      }
      return entry;
    },
    put(id: string, entry: SessionEntry) {
      sessions.set(id, entry);
    },
    delete(id: string) {
      sessions.delete(id);
    },
    pendingBytes(userId: string) {
      const at = now();
      store.prune(at);
      let total = 0;
      for (const entry of sessions.values()) {
        if (entry.userId === userId) total += entry.receivedBytes;
      }
      return total;
    },
    clear() {
      sessions.clear();
    },
  };

  // Used only by applyUploadChunk; keep the public type narrow.
  return Object.assign(store, { now, ttlMs, newId: options.id });
}

type FullStore = InternalStore & {
  now: () => number;
  ttlMs: number;
  newId?: () => string;
};

function asFullStore(store: AttachmentUploadStore): FullStore {
  return store as FullStore;
}

function decodeOptionalChunk(data: string | undefined): Buffer | null {
  if (data === undefined) return null;
  try {
    return decodeUploadedAttachmentData(data);
  } catch (error) {
    if (error instanceof EmptyAttachmentDataError) {
      throw new AttachmentUploadError("Empty file");
    }
    throw new AttachmentUploadError("Invalid base64 data");
  }
}

function assertWithinLimit(bytes: number): void {
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new AttachmentUploadError("File too large (max 5MB)");
  }
}

export function applyUploadChunk(
  store: AttachmentUploadStore,
  input: UploadChunkInput,
): UploadChunkResult {
  const full = asFullStore(store);
  const at = full.now();
  full.prune(at);

  if (input.uploadId) {
    const entry = full.get(input.userId, input.uploadId);
    if (!entry) {
      throw new AttachmentUploadError("Upload session not found");
    }

    const chunk = decodeOptionalChunk(input.data);
    if (chunk) {
      const nextBytes = entry.receivedBytes + chunk.length;
      assertWithinLimit(nextBytes);
      entry.parts.push(chunk);
      entry.receivedBytes = nextBytes;
      entry.expiresAt = at + full.ttlMs;
    } else if (input.done !== true) {
      throw new AttachmentUploadError("Missing chunk data");
    }

    if (input.done === true) {
      const bytes = Buffer.concat(entry.parts);
      full.delete(input.uploadId);
      return {
        complete: true,
        uploadId: input.uploadId,
        filename: entry.filename,
        contentType: entry.contentType,
        receivedBytes: bytes.length,
        bytes,
      };
    }

    return {
      complete: false,
      uploadId: input.uploadId,
      receivedBytes: entry.receivedBytes,
    };
  }

  if (!input.filename || !input.contentType) {
    throw new AttachmentUploadError("filename and contentType are required");
  }

  const chunk = decodeOptionalChunk(input.data);
  if (!chunk) {
    throw new AttachmentUploadError("Missing chunk data");
  }
  assertWithinLimit(chunk.length);

  if (input.done !== false) {
    return {
      complete: true,
      filename: input.filename,
      contentType: input.contentType,
      receivedBytes: chunk.length,
      bytes: chunk,
    };
  }

  const uploadId = full.newId?.() ?? randomBytes(16).toString("base64url");
  full.put(uploadId, {
    userId: input.userId,
    filename: input.filename,
    contentType: input.contentType,
    parts: [chunk],
    receivedBytes: chunk.length,
    expiresAt: at + full.ttlMs,
  });

  return {
    complete: false,
    uploadId,
    receivedBytes: chunk.length,
  };
}

const globalForUploads = globalThis as unknown as {
  attachmentUploadStore: AttachmentUploadStore | undefined;
};

export const defaultAttachmentUploadStore: AttachmentUploadStore =
  globalForUploads.attachmentUploadStore ?? createAttachmentUploadStore();

if (!globalForUploads.attachmentUploadStore) {
  globalForUploads.attachmentUploadStore = defaultAttachmentUploadStore;
}
