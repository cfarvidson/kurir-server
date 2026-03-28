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
  const saveSeqRef = useRef(0);
  const latestDataRef = useRef<DraftData | null>(null);
  const key = draftKey(userId, type, contextMessageId);

  // Load draft: localStorage first, server fallback
  const loadDraft = useCallback(async (): Promise<DraftData | null> => {
    // Try localStorage first (synchronous)
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const { updatedAt: _, ...data } = parsed;
        if (typeof data.body === "string" && typeof data.to === "string") {
          return data as DraftData;
        }
        // Corrupt data — remove it
        localStorage.removeItem(key);
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
        } catch {}
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
        } catch {}

        // 2. Server action (async) with sequence counter to discard stale saves
        setStatus("saving");
        const thisSeq = ++saveSeqRef.current;

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
          // Only update status if this is still the latest save
          if (saveSeqRef.current !== thisSeq) return;
          setStatus("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(
            () => setStatus("idle"),
            SAVED_DISPLAY_MS,
          );
        } catch {
          if (saveSeqRef.current !== thisSeq) return;
          setStatus("error");
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
    saveSeqRef.current++; // Poison any in-flight save
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    try {
      localStorage.removeItem(key);
    } catch {}
    try {
      await deleteDraftAction(type, contextMessageId);
    } catch {}
    setStatus("idle");
    latestDataRef.current = null;
  }, [key, type, contextMessageId, cancelPendingSave]);

  // Flush to localStorage on unmount + beforeunload (crash recovery)
  useEffect(() => {
    const flushToLocalStorage = () => {
      if (latestDataRef.current && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        try {
          localStorage.setItem(
            key,
            JSON.stringify({
              ...latestDataRef.current,
              updatedAt: Date.now(),
            }),
          );
        } catch {}
      }
    };

    window.addEventListener("beforeunload", flushToLocalStorage);
    return () => {
      window.removeEventListener("beforeunload", flushToLocalStorage);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      flushToLocalStorage();
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
