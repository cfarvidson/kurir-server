"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  generateDraft,
  getDraftGenerationSettings,
} from "@/actions/draft-generation";
import type { DraftType } from "@prisma/client";

/**
 * The one Generate-draft control, shared by the reply composer and the
 * full-page composer. Renders nothing until the server says a token is
 * stored. Generation is always a tap — never runs on mount. While a
 * generation is in flight the button becomes Cancel; cancelling ignores the
 * late response and leaves the composer as it was.
 */

export interface GeneratedDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

interface GenerateDraftButtonProps {
  type: Extract<DraftType, "REPLY" | "NEW">;
  contextMessageId: string;
  /** Current To field — required context for NEW, unused for REPLY. */
  to?: string;
  /** Whether the composer already holds typed text (drives confirm-first). */
  hasBody: boolean;
  onGenerated: (draft: GeneratedDraft) => void;
  disabled?: boolean;
}

export function GenerateDraftButton({
  type,
  contextMessageId,
  to,
  hasBody,
  onGenerated,
  disabled = false,
}: GenerateDraftButtonProps) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getDraftGenerationSettings()
      .then((status) => {
        if (!cancelled) setConnected(status.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!connected) return null;

  const missingTo = type === "NEW" && !(to ?? "").trim();

  const run = async (replace: boolean) => {
    const runId = ++runRef.current;
    setBusy(true);
    try {
      const result = await generateDraft({
        type,
        contextMessageId,
        to,
        replace,
      });
      if (runRef.current !== runId) return; // cancelled — ignore the late response
      if (result.ok) {
        onGenerated(result.draft);
        return;
      }
      if (result.code === "BODY_EXISTS") {
        if (confirm("Replace the existing draft text with a generated one?")) {
          await run(true);
        }
        return;
      }
      toast.error(result.error);
    } catch {
      if (runRef.current === runId) {
        toast.error("Could not generate a draft. The composer is unchanged.");
      }
    } finally {
      if (runRef.current === runId) setBusy(false);
    }
  };

  const handleClick = () => {
    if (busy) {
      // Cancel: bump the run id so the in-flight response is dropped.
      runRef.current++;
      setBusy(false);
      return;
    }
    if (hasBody) {
      if (!confirm("Replace your text with a generated draft?")) return;
      void run(true);
      return;
    }
    void run(false);
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1.5 px-2"
      onClick={handleClick}
      disabled={disabled || missingTo}
      title={
        missingTo
          ? "Add a To address to generate a draft"
          : busy
            ? "Cancel generation"
            : "Generate a draft from this conversation"
      }
    >
      {busy ? (
        <>
          <X className="h-3.5 w-3.5" />
          Cancel
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" />
          Generate draft
        </>
      )}
    </Button>
  );
}
