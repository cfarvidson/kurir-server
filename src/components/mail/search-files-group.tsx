"use client";

import { useState } from "react";
import {
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { formatDate } from "@/lib/date";
import { fileGroup, type FileGroup } from "@/lib/mail/file-types";
import { formatSize } from "@/lib/mail/format-size";
import type { FileRow } from "@/lib/mail/files";
import {
  AttachmentViewer,
  canPreview,
  type ViewerAttachment,
} from "@/components/mail/attachment-viewer";

const GROUP_ICON: Record<FileGroup, LucideIcon> = {
  image: ImageIcon,
  document: FileText,
  archive: FileArchive,
  other: FileIcon,
};

/**
 * Files group of the main search (kurir-ios#117). A row opens the file
 * itself: the viewer for previewable types, a download otherwise. No
 * navigation, no second search.
 */
export function SearchFilesGroup({ files }: { files: FileRow[] }) {
  const [viewing, setViewing] = useState<ViewerAttachment | null>(null);

  return (
    <div className="border-t px-4 py-3 md:px-6">
      <h3 className="eyebrow mb-1 text-muted-foreground">Files</h3>
      <ul>
        {files.map((file) => {
          const Icon = GROUP_ICON[fileGroup(file.contentType)];
          const sender =
            file.message?.fromName || file.message?.fromAddress || "Unknown";
          const rowClass =
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60";
          const content = (
            <>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {file.filename}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sender}
                  {file.message?.subject ? ` · ${file.message.subject}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                <span className="block">{formatSize(file.size)}</span>
                {file.message?.receivedAt && (
                  <span className="block" suppressHydrationWarning>
                    {formatDate(new Date(file.message.receivedAt))}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={file.id}>
              {canPreview(file.contentType) ? (
                <button
                  type="button"
                  onClick={() => setViewing(file)}
                  className={rowClass}
                >
                  {content}
                </button>
              ) : (
                <a
                  href={`/api/attachments/${file.id}`}
                  download={file.filename}
                  className={rowClass}
                >
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ul>

      <AttachmentViewer
        attachment={viewing}
        open={viewing !== null}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
      />
    </div>
  );
}
