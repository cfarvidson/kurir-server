"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  generateDraft,
  getDraftGenerationSettings,
} from "@/actions/draft-generation";
import type { DraftTone } from "@/lib/draft-generation/types";
import type { DraftType } from "@prisma/client";

/**
 * The compose assistant (#133), shared by the reply composer and the
 * full-page composer. The sparkles button opens a panel instead of firing
 * blindly: the user says what the mail should say, picks a tone, and
 * generates. Every round is kept as a version so they can flip back, and
 * nothing reaches the composer until Insert — generation never overwrites
 * typed text. Versions live here and die with the composer.
 *
 * Leaving the instruction empty reproduces the old one-tap behaviour.
 */

export interface GeneratedDraft {
  body: string;
  subject?: string;
}

const TONES: { value: DraftTone; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "formal", label: "Formal" },
  { value: "friendly", label: "Friendly" },
  { value: "direct", label: "Direct" },
];

const TONE_STORAGE_KEY = "kurir.draft-tone";

function storedTone(): DraftTone {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(TONE_STORAGE_KEY);
    return TONES.some((t) => t.value === raw) ? (raw as DraftTone) : "auto";
  } catch {
    // Private mode / storage disabled: stay on Auto for this composer.
    return "auto";
  }
}

interface DraftAssistantProps {
  type: Extract<DraftType, "REPLY" | "NEW">;
  contextMessageId: string;
  /** Current To field — required context for NEW, unused for REPLY. */
  to?: string;
  onInsert: (draft: GeneratedDraft) => void;
  disabled?: boolean;
}

export function DraftAssistant({
  type,
  contextMessageId,
  to,
  onInsert,
  disabled = false,
}: DraftAssistantProps) {
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [tone, setTone] = useState<DraftTone>("auto");
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<GeneratedDraft[]>([]);
  const [index, setIndex] = useState(0);
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

  useEffect(() => {
    setTone(storedTone());
  }, []);

  if (!connected) return null;

  const missingTo = type === "NEW" && !(to ?? "").trim();
  const current = versions[index];

  const pickTone = (next: DraftTone) => {
    setTone(next);
    try {
      window.localStorage.setItem(TONE_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled: the tone just stays per-composer.
    }
  };

  const cancel = () => {
    // Bump the run id so the in-flight response is dropped.
    runRef.current += 1;
    setBusy(false);
  };

  const generate = async () => {
    const runId = ++runRef.current;
    setBusy(true);
    try {
      const result = await generateDraft({
        type,
        contextMessageId,
        to,
        // Always sent, even empty: the field is what puts the server in
        // panel mode, and an empty one means "infer it, like before".
        instruction,
        tone,
      });
      if (runRef.current !== runId) return; // cancelled — drop the late answer
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!("body" in result)) {
        toast.error("Your server does not support the assistant yet. Update the server.");
        return;
      }
      setVersions((prev) => {
        setIndex(prev.length);
        return [...prev, { body: result.body, subject: result.subject }];
      });
    } catch {
      if (runRef.current === runId) {
        toast.error("Could not generate a draft. The composer is unchanged.");
      }
    } finally {
      if (runRef.current === runId) setBusy(false);
    }
  };

  const insert = () => {
    if (!current) return;
    onInsert(current);
    setOpen(false);
  };

  /**
   * The whole panel is drivable from the keyboard (Cmd/Ctrl+Enter generates,
   * +Shift inserts, Alt+arrows flip versions). Alt rather than Cmd for the
   * pager: Cmd+[ / Cmd+] are the browser's own back and forward.
   */
  const panelKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) insert();
      else if (!busy) void generate();
      return;
    }
    if (!e.altKey || versions.length === 0) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setIndex((i) => Math.min(versions.length - 1, i + 1));
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) cancel();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 px-2"
          disabled={disabled || missingTo}
          title={
            missingTo
              ? "Add a To address to generate a draft"
              : "Write this mail with the assistant"
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate draft
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-96 space-y-3"
        onKeyDown={panelKeyDown}
      >
        <div>
          <label
            htmlFor="draft-assistant-instruction"
            className="text-xs font-medium"
          >
            What should this mail say?
          </label>
          <textarea
            id="draft-assistant-instruction"
            autoFocus
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Say I can't make Tuesday and offer Thursday instead. Leave empty to let it infer."
            className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
          />
        </div>

        <div>
          <p className="text-xs font-medium">Tone</p>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {TONES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={tone === option.value}
                onClick={() => pickTone(option.value)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  tone === option.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => (busy ? cancel() : void generate())}
          >
            {busy ? (
              <>
                <X className="h-3.5 w-3.5" />
                Cancel
              </>
            ) : versions.length > 0 ? (
              "Generate again"
            ) : (
              "Generate"
            )}
          </Button>
          {busy && (
            <span className="text-xs text-muted-foreground">Writing…</span>
          )}
        </div>

        {current && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="px-1"
                aria-label="Previous version"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {index + 1}/{versions.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="px-1"
                aria-label="Next version"
                disabled={index >= versions.length - 1}
                onClick={() =>
                  setIndex((i) => Math.min(versions.length - 1, i + 1))
                }
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" className="ml-auto" onClick={insert}>
                Insert
              </Button>
            </div>
            {current.subject && (
              <p className="text-xs text-muted-foreground">
                Subject: {current.subject}
              </p>
            )}
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm">
              {current.body}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
