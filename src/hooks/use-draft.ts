"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftType } from "@prisma/client";
import {
  saveDraft as saveDraftAction,
  getDraft,
  getAttachmentMeta,
  deleteDraft as deleteDraftAction,
} from "@/actions/drafts";
import type { DraftAttachmentMeta } from "@/lib/mail/drafts";
import { parseDraftGroups, type DraftGroup } from "@/lib/mail/draft-groups";

export interface DraftData {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  emailConnectionId?: string;
  attachmentIds: string[];
  attachments?: DraftAttachmentMeta[];
  groups?: DraftGroup[];
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
  // The server's updatedAt for the last copy saved or loaded here.
  const serverUpdatedAtRef = useRef(0);
  const key = draftKey(userId, type, contextMessageId);

  // Load draft: the local copy holds edits not yet saved (crash recovery),
  // but it lingers after the composer closes. Unless it is unsaved, the
  // server copy wins when the server saved it after the local copy's last
  // save (an agent or another device changed it), or autosave would write the
  // stale copy back, `groups: []` included. Only server times are compared,
  // so the browser's clock never decides.
  const loadDraft = useCallback(async (): Promise<DraftData | null> => {
    let local: {
      data: DraftData;
      serverUpdatedAt: number;
      unsaved: boolean;
    } | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const { updatedAt: _, serverUpdatedAt, unsaved, ...data } = parsed;
        if (typeof data.body === "string" && typeof data.to === "string") {
          local = {
            data: { ...(data as DraftData), groups: parseDraftGroups(data.groups) },
            serverUpdatedAt:
              typeof serverUpdatedAt === "number" ? serverUpdatedAt : 0,
            unsaved: unsaved === true,
          };
        } else {
          // Corrupt data — remove it
          localStorage.removeItem(key);
        }
      }
    } catch {
      // localStorage unavailable or corrupt
    }

    try {
      const serverDraft = await getDraft(type, contextMessageId);
      const serverUpdatedAt = serverDraft
        ? new Date(serverDraft.updatedAt).getTime()
        : 0;
      if (
        serverDraft &&
        (!local ||
          (!local.unsaved && serverUpdatedAt > local.serverUpdatedAt))
      ) {
        serverUpdatedAtRef.current = serverUpdatedAt;
        const data: DraftData = {
          to: serverDraft.to,
          cc: serverDraft.cc,
          bcc: serverDraft.bcc,
          subject: serverDraft.subject,
          body: serverDraft.body,
          emailConnectionId: serverDraft.emailConnectionId ?? undefined,
          attachmentIds: serverDraft.attachmentIds,
          attachments: serverDraft.attachments,
          groups: parseDraftGroups(serverDraft.groups),
        };
        // Backfill localStorage for next load
        writeLocalCopy(key, data, serverUpdatedAt, false);
        return data;
      }
    } catch {
      // Server error — fall back to the local copy
    }

    if (local) {
      serverUpdatedAtRef.current = local.serverUpdatedAt;
      return hydrateAttachments(local.data);
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
        !data.to.trim() &&
        !(data.cc ?? "").trim() &&
        !(data.bcc ?? "").trim() &&
        data.attachmentIds.length === 0 &&
        !data.groups?.length;

      timerRef.current = setTimeout(async () => {
        // No longer pending: closing the composer now has nothing to flush.
        timerRef.current = null;
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

        // 1. localStorage (synchronous, instant), unsaved until the server
        // answers
        writeLocalCopy(key, data, serverUpdatedAtRef.current, true);

        // 2. Server action (async) with sequence counter to discard stale saves
        setStatus("saving");
        const thisSeq = ++saveSeqRef.current;

        try {
          const saved = await saveDraftAction({
            type,
            contextMessageId,
            to: data.to,
            cc: data.cc,
            bcc: data.bcc,
            subject: data.subject,
            body: data.body,
            emailConnectionId: data.emailConnectionId,
            attachmentIds: data.attachmentIds,
            groups: data.groups,
          });
          // Only update status if this is still the latest save
          if (saveSeqRef.current !== thisSeq) return;
          serverUpdatedAtRef.current = new Date(saved.updatedAt).getTime();
          writeLocalCopy(key, data, serverUpdatedAtRef.current, false);
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
        writeLocalCopy(
          key,
          latestDataRef.current,
          serverUpdatedAtRef.current,
          true,
        );
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

/**
 * The local copy records the server's updatedAt it is based on, and whether
 * it holds edits the server has not confirmed yet.
 */
function writeLocalCopy(
  key: string,
  data: DraftData,
  serverUpdatedAt: number,
  unsaved: boolean,
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...data, serverUpdatedAt, unsaved }),
    );
  } catch {}
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

/** Remove a draft's localStorage copy (catalog delete, plan 037). */
async function hydrateAttachments(data: DraftData): Promise<DraftData> {
  if (
    data.attachmentIds.length === 0 ||
    (data.attachments && data.attachments.length > 0)
  ) {
    return data;
  }
  try {
    const attachments = await getAttachmentMeta(data.attachmentIds);
    return { ...data, attachments };
  } catch {
    return data;
  }
}

export function clearDraftInLocalStorage(
  userId: string,
  type: DraftType,
  contextMessageId: string,
): void {
  try {
    localStorage.removeItem(draftKey(userId, type, contextMessageId));
  } catch {}
}
