"use client";

import { create } from "zustand";

export interface PendingSend {
  id: string;
  createdAt: number;
  delayMs: number;
}

interface PendingSendStore {
  pendingSends: Record<string, PendingSend>;
  timers: Record<string, ReturnType<typeof setTimeout>>;

  enqueue: (
    send: PendingSend,
    onExpire: () => Promise<void>,
    onSuccess: () => void,
    onError: (error: string) => void,
  ) => void;
  cancel: (id: string) => PendingSend | undefined;
  complete: (id: string) => void;
}

export const usePendingSendStore = create<PendingSendStore>()((set, get) => ({
  pendingSends: {},
  timers: {},

  enqueue: (send, onExpire, onSuccess, onError) => {
    const timer = setTimeout(async () => {
      try {
        await onExpire();
        get().complete(send.id);
        onSuccess();
      } catch (err) {
        get().complete(send.id);
        onError(err instanceof Error ? err.message : "Failed to send");
      }
    }, send.delayMs);

    set((state) => ({
      pendingSends: { ...state.pendingSends, [send.id]: send },
      timers: { ...state.timers, [send.id]: timer },
    }));
  },

  cancel: (id) => {
    const send = get().pendingSends[id];
    const timer = get().timers[id];
    if (timer) clearTimeout(timer);
    set((state) => {
      const { [id]: _send, ...restSends } = state.pendingSends;
      const { [id]: _timer, ...restTimers } = state.timers;
      return { pendingSends: restSends, timers: restTimers };
    });
    return send;
  },

  complete: (id) => {
    const timer = get().timers[id];
    if (timer) clearTimeout(timer);
    set((state) => {
      const { [id]: _send, ...restSends } = state.pendingSends;
      const { [id]: _timer, ...restTimers } = state.timers;
      return { pendingSends: restSends, timers: restTimers };
    });
  },
}));
