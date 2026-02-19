---
title: "feat: Auto-poll imbox with React Query"
type: feat
date: 2026-02-16
---

# Auto-Poll Imbox with React Query

## Overview

Replace the one-shot `AutoSync` component with React Query polling that calls `/api/mail/sync` every 5 seconds. New emails appear in the imbox within 2-5 seconds without manual reload.

## Why This Approach

- **Simple**: ~80 lines of meaningful code across 5-6 files
- **React Query already installed** (`@tanstack/react-query@^5.62`) but unused — this sets up the foundation
- **Delta sync is cheap**: the existing sync service skips known UIDs, so "no new mail" polls are fast IMAP round-trips
- **Scales later**: can upgrade to IMAP IDLE + SSE without changing the client-side pattern

## Key Decisions

- **Poll interval: 5s** — balances responsiveness vs IMAP load for single-user
- **Use `router.refresh()` on new messages only** — avoids unnecessary server component re-renders when nothing changed
- **Pause polling when tab is hidden** — `refetchIntervalInBackground: false`
- **Immediate sync on tab focus** — `refetchOnWindowFocus: true` for instant catch-up when user returns
- **No loading spinner** — sync is background/invisible, same as current behavior
- **Scope provider to `(mail)` layout only** — no polling on login/setup pages, no stale auth leakage
- **React Query as polling scheduler only** — not a data cache; `staleTime: 0`, `gcTime: 0`

## Acceptance Criteria

- [x] New emails appear in imbox within ~5 seconds of IMAP delivery without page reload
- [x] New messages in an open thread view appear without navigating away
- [x] Sidebar unread counts update when new messages arrive
- [x] Polling pauses when browser tab is hidden, resumes immediately on focus
- [x] No visible loading states or spinners — background sync stays invisible
- [x] Polling errors are silently retried (no user-facing error UI)
- [x] Existing behavior (page load sync, router refresh) is preserved

## Implementation Steps

### 1. Add QueryClientProvider — `src/components/providers.tsx` (new file)

Wrap the mail routes in a React Query provider. Separate client component keeps the layout as a server component.

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            staleTime: 0,
            gcTime: 0,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

### 2. Mount Providers in mail layout — `src/app/(mail)/layout.tsx`

Wrap `{children}` with `<Providers>`. Scoped to `(mail)` routes only — no polling on login/setup pages, and the QueryClient is tied to the authenticated session lifecycle.

### 3. Replace AutoSync with polling hook — `src/components/mail/auto-sync.tsx`

Replace the fire-once `useEffect` with `useQuery` polling every 5 seconds.

In React Query v5, `onSuccess` was removed from `useQuery`. Use a `useEffect` watching `data` to trigger `router.refresh()` only when new messages are found.

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export function AutoSync() {
  const router = useRouter();
  const prevDataRef = useRef<unknown>(null);

  const { data } = useQuery({
    queryKey: ["mail-sync"],
    queryFn: async () => {
      const res = await fetch("/api/mail/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    const hasNew = data.results?.some(
      (r: { newMessages: number }) => r.newMessages > 0,
    );
    if (hasNew) {
      router.refresh();
    }
  }, [data, router]);

  return null;
}
```

**Note on overlapping syncs:** React Query does not fire a new `refetchInterval` tick if the previous query is still in-flight. So if a sync takes >5s (large mailbox, slow IMAP), the next poll is simply skipped. No concurrent sync protection needed.

### 4. Fix stale client state in ThreadPageContent — `src/components/mail/thread-page-content.tsx`

**Critical gap:** `ThreadPageContent` holds server data in `useState(initialMessages)`. When `router.refresh()` re-renders the parent server component with new props, `useState`'s initializer does NOT re-run — so new messages in an open thread would be invisible.

Fix: add a `useEffect` that syncs the prop into state when it changes.

```tsx
// Add after the existing useState(initialMessages) line:
useEffect(() => {
  setMessages(initialMessages);
}, [initialMessages]);
```

This preserves the optimistic reply pattern (local `setMessages` for sent replies) while picking up new messages from `router.refresh()`.

### 5. Fix stale client state in ScreenerView — `src/components/screener/screener-view.tsx`

Same pattern: `ScreenerView` holds `useState(initialSenders)` which won't update on refresh.

```tsx
// Add after the existing useState(initialSenders) line:
useEffect(() => {
  setSenders(initialSenders);
}, [initialSenders]);
```

### 6. No sync API changes needed — `src/app/api/mail/sync/route.ts`

Current response already includes `newMessages` per folder. No changes required.

## File Change Summary

| File                                          | Action | Purpose                                |
| --------------------------------------------- | ------ | -------------------------------------- |
| `src/components/providers.tsx`                | Create | QueryClientProvider setup              |
| `src/app/(mail)/layout.tsx`                   | Edit   | Wrap children in `<Providers>`         |
| `src/components/mail/auto-sync.tsx`           | Edit   | Replace one-shot with React Query poll |
| `src/components/mail/thread-page-content.tsx` | Edit   | Sync props into state on refresh       |
| `src/components/screener/screener-view.tsx`   | Edit   | Sync props into state on refresh       |
| `src/app/api/mail/sync/route.ts`              | None   | Already returns `newMessages`          |

## Edge Cases Considered

- **Scroll position on refresh**: Next.js 15 `router.refresh()` preserves scroll position (re-renders in place, doesn't navigate). Verify during testing.
- **Auth expiry**: 401 from sync API throws in `queryFn`, React Query retries twice then stops until next interval. Acceptable for MVP — user will discover expired session on next interaction.
- **IMAP server down**: React Query's built-in retry (2 attempts) + the 5s interval means it naturally backs off. Acceptable for single-user.
- **Reply mid-compose**: `ReplyComposer` holds text in `useState` — `router.refresh()` doesn't affect it.
- **Concurrent server actions**: If user archives/approves while a poll fires, Next.js deduplicates concurrent `router.refresh()` calls. No conflict.

## Follow-up Opportunities (not in MVP)

- Subtle sync indicator (pulsing dot) when actively syncing
- Configurable poll interval
- Error backoff (slow down to 30s after repeated failures)
- IMAP IDLE + SSE for true sub-second delivery

## References

- [auto-sync.tsx](src/components/mail/auto-sync.tsx) — current one-shot sync
- [layout.tsx](<src/app/(mail)/layout.tsx>) — where AutoSync is mounted
- [sync route](src/app/api/mail/sync/route.ts) — sync API endpoint
- [thread-page-content.tsx](src/components/mail/thread-page-content.tsx) — client state for threads
- [screener-view.tsx](src/components/screener/screener-view.tsx) — client state for screener
