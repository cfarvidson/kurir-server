"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftType } from "@prisma/client";
import {
  saveDraft as saveDraftAction,
  getDraft,
  deleteDraft as deleteDraftAction,
} from "@/actions/drafts";

export interface DraftData {
  to: string;
  subject: string;
  body: string;
  emailConnectionId?: string;
  attachmentIds: string[];
}

export type DraftStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 2000;
const SAVED_DISPLAY_MS = 2000;

function draftKey(userId: string, type: DraftType, contextId: string) {
  return `kurir:draft:${userId}:${type.toLowerCase()}:${contextId}`;
}

export function useDraft(
  userId: string,
  type: DraftType,
  contextMessageId: string = "__new__",
) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latestDataRef = useRef<DraftData | null>(null);
  const key = draftKey(userId, type, contextMessageId);

  // Load draft: localStorage first, server fallback
  const loadDraft = useCallback(async (): Promise<DraftData | null> => {
    // Try localStorage first (synchronous)
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Strip updatedAt before returning
        const { updatedAt: _, ...data } = parsed;
        return data as DraftData;
      }
    } catch {
      // localStorage unavailable or corrupt
    }

    // Server fallback (async)
    try {
      const serverDraft = await getDraft(type, contextMessageId);
      if (serverDraft) {
        const data: DraftData = {
          to: serverDraft.to,
          subject: serverDraft.subject,
          body: serverDraft.body,
          emailConnectionId: serverDraft.emailConnectionId ?? undefined,
          attachmentIds: serverDraft.attachmentIds,
        };
        // Backfill localStorage for next load
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ ...data, updatedAt: Date.now() }),
          );
        } catch {
          // QuotaExceededError — server is the backup
        }
        return data;
      }
    } catch {
      // Server error — no draft available
    }

    return null;
  }, [key, type, contextMessageId]);

  // Save draft with debounce: localStorage sync + server async
  const saveDraft = useCallback(
    (data: DraftData) => {
      latestDataRef.current = data;

      // Clear previous debounce timer
      if (timerRef.current) clearTimeout(timerRef.current);

      // Auto-delete empty drafts
      const isEmpty =
        !data.body.trim() &&
        !data.subject.trim() &&
        data.attachmentIds.length === 0;

      timerRef.current = setTimeout(async () => {
        if (isEmpty) {
          try {
            localStorage.removeItem(key);
          } catch {}
          try {
            await deleteDraftAction(type, contextMessageId);
          } catch {}
          setStatus("idle");
          return;
        }

        // 1. localStorage (synchronous, instant)
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ ...data, updatedAt: Date.now() }),
          );
        } catch {
          // QuotaExceededError — rely on server sync
        }

        // 2. Server action (async)
        setStatus("saving");

        // Abort any in-flight save
        abortRef.current?.abort();
        abortRef.current = new AbortController();

        try {
          await saveDraftAction({
            type,
            contextMessageId,
            to: data.to,
            subject: data.subject,
            body: data.body,
            emailConnectionId: data.emailConnectionId,
            attachmentIds: data.attachmentIds,
          });
          setStatus("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(
            () => setStatus("idle"),
            SAVED_DISPLAY_MS,
          );
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setStatus("error");
          }
        }
      }, DEBOUNCE_MS);
    },
    [key, type, contextMessageId],
  );

  // Cancel any pending debounce (useful before send)
  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Delete draft from both stores
  const removeDraft = useCallback(async () => {
    cancelPendingSave();
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage unavailable
    }
    try {
      await deleteDraftAction(type, contextMessageId);
    } catch {
      // Server error — localStorage already cleared
    }
    setStatus("idle");
    latestDataRef.current = null;
  }, [key, type, contextMessageId, cancelPendingSave]);

  // Flush to localStorage on unmount (crash recovery for in-debounce content)
  useEffect(() => {
    return () => {
      if (latestDataRef.current && timerRef.current) {
        clearTimeout(timerRef.current);
        try {
          localStorage.setItem(
            key,
            JSON.stringify({
              ...latestDataRef.current,
              updatedAt: Date.now(),
            }),
          );
        } catch {
          // Best effort
        }
      }
    };
  }, [key]);

  return { loadDraft, saveDraft, removeDraft, cancelPendingSave, status };
}

/** Check if a draft exists in localStorage (synchronous, for use in render) */
export function hasDraftInLocalStorage(
  userId: string,
  type: DraftType,
  contextMessageId: string,
): boolean {
  try {
    return (
      localStorage.getItem(draftKey(userId, type, contextMessageId)) !== null
    );
  } catch {
    return false;
  }
}
