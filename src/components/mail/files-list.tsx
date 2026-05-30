"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { formatDate } from "@/lib/date";
import { fileGroup, type FileGroup } from "@/lib/mail/file-types";
import { loadMoreFiles } from "@/actions/files";
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FilesListProps {
  initialFiles: FileRow[];
  initialCursor: string | null;
  /** Current filters, echoed back to the server action for "Load more". */
  group: FileGroup | null;
  query: string | null;
}

export function FilesList({
  initialFiles,
  initialCursor,
  group,
  query,
}: FilesListProps) {
  const [files, setFiles] = useState(initialFiles);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();
  const [viewing, setViewing] = useState<ViewerAttachment | null>(null);

  function handleLoadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await loadMoreFiles({ group, q: query, cursor });
      setFiles((prev) => [...prev, ...result.files]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-6">
      <ul className="divide-y divide-border/60">
        {files.map((file) => {
          const Icon = GROUP_ICON[fileGroup(file.contentType)];
          const sender =
            file.message?.fromName || file.message?.fromAddress || "Unknown";
          const previewable = canPreview(file.contentType);
          const rowClass =
            "flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/50";
          const rowContent = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {file.filename}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sender}
                  {file.message?.subject ? ` · ${file.message.subject}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block tabular-nums">
                  {formatSize(file.size)}
                </span>
                {file.message?.receivedAt && (
                  <span className="block tabular-nums" suppressHydrationWarning>
                    {formatDate(new Date(file.message.receivedAt))}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={file.id}>
              {previewable ? (
                <button
                  type="button"
                  onClick={() => setViewing(file)}
                  className={rowClass}
                >
                  {rowContent}
                </button>
              ) : (
                <a
                  href={`/api/attachments/${file.id}`}
                  download={file.filename}
                  className={rowClass}
                >
                  {rowContent}
                </a>
              )}
              {/* Quick link to open the containing thread */}
              {file.message?.id && (
                <Link
                  href={`/imbox/${file.message.id}`}
                  className="ml-[3.25rem] inline-block pb-2 text-[11px] text-primary/70 hover:text-primary hover:underline"
                >
                  Open message
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Load more
          </button>
        </div>
      )}

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
