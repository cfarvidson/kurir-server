---
title: "refactor: Move sidebar-counts revalidation to client-side server action"
type: refactor
date: 2026-02-19
---

# refactor: Move sidebar-counts revalidation to client-side server action

## Overview

`revalidateTag("sidebar-counts")` was called inside `getThreadMessages()` during server component render to update the sidebar unread badge after marking messages as read. This causes re-render issues because `revalidateTag` during render triggers a layout refresh mid-request.

The fix: a tiny client component calls a server action on mount to revalidate the sidebar cache — after the page has already rendered.

## Proposed Solution

Three small pieces:

### 1. Server action: `src/actions/sidebar.ts`

```typescript
"use server";

import { revalidateTag } from "next/cache";

export async function refreshSidebarCounts() {
  revalidateTag("sidebar-counts");
}
```

### 2. Client component: `src/components/mail/sidebar-refresh.tsx`

```typescript
"use client";

import { useEffect } from "react";
import { refreshSidebarCounts } from "@/actions/sidebar";

export function SidebarRefresh() {
  useEffect(() => {
    refreshSidebarCounts();
  }, []);
  return null;
}
```

### 3. Wire into thread pages

In each of the 4 thread pages, add after the `pushFlagsToImap` block:

- `src/app/(mail)/imbox/[id]/page.tsx`
- `src/app/(mail)/archive/[id]/page.tsx`
- `src/app/(mail)/feed/[id]/page.tsx`
- `src/app/(mail)/paper-trail/[id]/page.tsx`

```tsx
import { SidebarRefresh } from "@/components/mail/sidebar-refresh";

// In the JSX return, before ArchiveKeyboardShortcut:
{
  markedRead.length > 0 && <SidebarRefresh />;
}
```

### 4. Keep `threads.ts` clean (already done)

The `revalidateTag` import and call have already been removed from `getThreadMessages()`. No changes needed.

## Acceptance Criteria

- [ ] Opening a thread marks messages as read (existing behavior preserved)
- [ ] Sidebar unread badge updates shortly after the thread page renders
- [ ] No re-render flash or layout shift when opening threads
- [ ] `getThreadMessages()` remains a pure data function with no cache side effects
- [ ] `pushFlagsToImap` still fires from the server component (unchanged)

## Context

- Previous fix that added `revalidateTag` to render: [sidebar-fixes-brainstorm.md](docs/brainstorms/2026-02-16-sidebar-fixes-brainstorm.md)
- Sidebar cache setup: [layout.tsx:11-23](<src/app/(mail)/layout.tsx#L11-L23>) — `unstable_cache` with `sidebar-counts` tag, 30s TTL
- Thread page pattern: [imbox/[id]/page.tsx:36-49](<src/app/(mail)/imbox/[id]/page.tsx#L36-L49>) — `getThreadMessages` + `pushFlagsToImap`
- All existing `revalidateTag("sidebar-counts")` calls in server actions: [archive.ts](src/actions/archive.ts), [senders.ts](src/actions/senders.ts), [reply.ts](src/actions/reply.ts)
