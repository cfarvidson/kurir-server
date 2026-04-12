"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { marked } from "marked";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AttachmentChips } from "@/components/mail/attachment-chips";
import { Paperclip, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadedAttachment } from "@/hooks/use-attachments";

// Configure marked for GFM
marked.setOptions({ gfm: true, breaks: true });

interface MarkdownComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  attachments: UploadedAttachment[];
  onFileUpload: (file: File) => Promise<UploadedAttachment | null>;
  onFileRemove: (id: string) => void;
  /** Minimum height in px */
  minHeight?: number;
  /** Called on Cmd+Enter */
  onSubmit?: () => void;
  /** Called on Cmd+Shift+Enter */
  onSchedule?: () => void;
  /** Called on Escape */
  onCancel?: () => void;
  /** Auto-focus the textarea */
  autoFocus?: boolean;
  className?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function MarkdownComposer({
  value,
  onChange,
  placeholder = "Write your message...",
  disabled = false,
  attachments,
  onFileUpload,
  onFileRemove,
  minHeight = 200,
  onSubmit,
  onSchedule,
  onCancel,
  autoFocus = false,
  className,
}: MarkdownComposerProps) {
  const [tab, setTab] = useState<string>("write");
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // Keep a ref to the latest value so async callbacks don't capture stale closures
  const valueRef = useRef(value);
  valueRef.current = value;

  // Focus without scrolling the page (native autoFocus causes scroll jumps)
  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, minHeight) + "px";
    }
  }, [minHeight]);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Insert text at cursor position
  const insertAtCursor = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      const current = valueRef.current;
      if (!el) {
        onChange(current + text);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newValue = current.slice(0, start) + text + current.slice(end);
      onChange(newValue);

      // Restore cursor position after the inserted text
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
      });
    },
    [onChange],
  );

  // Replace a placeholder string in the value
  const replacePlaceholder = useCallback(
    (placeholder: string, replacement: string) => {
      onChange(valueRef.current.replace(placeholder, replacement));
    },
    [onChange],
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (isImageFile(file)) {
        // Insert placeholder while uploading
        const placeholderText = `![Uploading ${file.name}...]()`;
        insertAtCursor(placeholderText);

        const result = await onFileUpload(file);
        if (result) {
          // Replace placeholder with actual markdown
          replacePlaceholder(
            placeholderText,
            `![${result.filename}](${result.url})`,
          );
        } else {
          // Remove placeholder on failure
          replacePlaceholder(placeholderText, "");
        }
      } else {
        // Non-image files just upload, shown as chips
        await onFileUpload(file);
      }
    },
    [insertAtCursor, replacePlaceholder, onFileUpload],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload],
  );

  // Drag & drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Clipboard paste handler
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      // Check if any are images (prefer file paste over text paste)
      const imageFiles = Array.from(files).filter(isImageFile);
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFiles(imageFiles);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        onSchedule?.();
      } else {
        onSubmit?.();
      }
    }
    if (e.key === "Escape") {
      onCancel?.();
    }
  };

  const previewHtml = marked.parse(value || "*Nothing to preview*") as string;

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between">
          <TabsList className="h-8">
            <TabsTrigger value="write" className="px-3 py-1 text-xs">
              Write
            </TabsTrigger>
            <TabsTrigger value="preview" className="px-3 py-1 text-xs">
              Preview
            </TabsTrigger>
          </TabsList>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        </div>

        <TabsContent value="write" className="mt-2 md:mt-2">
          <textarea
            ref={textareaRef}
            spellCheck={false}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              autoResize();
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "block w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono",
              "placeholder:text-muted-foreground/50",
              "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:opacity-50",
            )}
            style={{ minHeight: `${minHeight}px` }}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-2 md:mt-2">
          <div
            className={cn(
              "prose prose-sm dark:prose-invert max-w-none rounded-md border border-input px-3 py-2",
              "prose-img:rounded-md prose-img:max-h-[400px]",
            )}
            style={{ minHeight: `${minHeight}px` }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </TabsContent>
      </Tabs>

      {/* Attachment chips (non-image files — images are shown inline) */}
      <AttachmentChips
        attachments={attachments}
        onRemove={onFileRemove}
        excludeImages
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleFiles(e.target.files);
          }
          e.target.value = ""; // Reset so same file can be re-selected
        }}
      />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Upload className="h-5 w-5" />
            Drop files to attach
          </div>
        </div>
      )}
    </div>
  );
}
