"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveThreadNote } from "@/actions/thread-notes";
import { MAX_THREAD_NOTE_CHARS } from "@/lib/mail/thread-note";

/**
 * Private per-thread note. Lives next to the subject, never in the reply
 * composer, and is never sent with outgoing mail.
 */
export function ThreadNoteEditor({
  threadId,
  initialBody,
}: {
  threadId: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [open, setOpen] = useState(() => !!initialBody.trim());
  const savedRef = useRef(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openedByUser = useRef(false);

  const persist = useCallback(
    async (value: string) => {
      if (value === savedRef.current) return;
      try {
        await saveThreadNote(threadId, value);
        savedRef.current = value;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not save the note.",
        );
      }
    },
    [threadId],
  );

  useEffect(() => {
    if (body === savedRef.current) return;
    const timer = setTimeout(() => {
      void persist(body);
    }, 600);
    return () => clearTimeout(timer);
  }, [body, persist]);

  useEffect(() => {
    if (open && openedByUser.current) textareaRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            openedByUser.current = true;
            setOpen(true);
          }}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Add a private note
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <label htmlFor="thread-note" className="eyebrow text-muted-foreground">
        Private note
      </label>
      <textarea
        ref={textareaRef}
        id="thread-note"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_THREAD_NOTE_CHARS))}
        onBlur={() => void persist(body)}
        rows={body.trim() ? 3 : 2}
        maxLength={MAX_THREAD_NOTE_CHARS}
        placeholder="Stays on this thread. Never sent with a reply."
        className="mt-1.5 w-full resize-y rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
