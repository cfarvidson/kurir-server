"use client";

import { useState, useCallback, useRef } from "react";

export interface UploadedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  status: "uploading" | "done" | "error";
}

interface UseAttachmentsReturn {
  attachments: UploadedAttachment[];
  upload: (file: File) => Promise<UploadedAttachment | null>;
  remove: (id: string) => Promise<void>;
  totalSize: number;
  isUploading: boolean;
  /** Reset to a known set of attachments (e.g. for forward or undo restore) */
  setAttachments: (attachments: UploadedAttachment[]) => void;
  /** Get a snapshot of current attachments (for saving to ref before send) */
  getSnapshot: () => UploadedAttachment[];
}

export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const attachmentsRef = useRef<UploadedAttachment[]>([]);

  // Keep ref in sync
  attachmentsRef.current = attachments;

  const totalSize = attachments
    .filter((a) => a.status !== "error")
    .reduce((sum, a) => sum + a.size, 0);

  const isUploading = attachments.some((a) => a.status === "uploading");

  const upload = useCallback(
    async (file: File): Promise<UploadedAttachment | null> => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const placeholder: UploadedAttachment = {
        id: tempId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        url: "",
        status: "uploading",
      };

      setAttachments((prev) => [...prev, placeholder]);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/attachments/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        const data = await res.json();

        const uploaded: UploadedAttachment = {
          id: data.id,
          filename: data.filename,
          contentType: data.contentType,
          size: data.size,
          url: data.url,
          status: "done",
        };

        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? uploaded : a)),
        );

        return uploaded;
      } catch (err) {
        console.error("[useAttachments] upload error:", err);
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId ? { ...a, status: "error" as const } : a,
          ),
        );
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    const attachment = attachmentsRef.current.find((a) => a.id === id);

    // Remove from UI immediately
    setAttachments((prev) => prev.filter((a) => a.id !== id));

    // Delete from server if it was uploaded (not a temp/error entry)
    if (attachment?.status === "done" && !id.startsWith("temp-")) {
      try {
        await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      } catch {
        // Best effort — orphan cleanup will handle it
      }
    }
  }, []);

  const getSnapshot = useCallback(() => {
    return [...attachmentsRef.current];
  }, []);

  return {
    attachments,
    upload,
    remove,
    totalSize,
    isUploading,
    setAttachments,
    getSnapshot,
  };
}
