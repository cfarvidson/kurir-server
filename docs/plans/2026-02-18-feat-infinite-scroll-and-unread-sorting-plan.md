---
title: "feat: Infinite scroll and unread-first sorting for mail categories"
type: feat
date: 2026-02-18
---

# Infinite Scroll & Unread Sorting

## Overview

Add cursor-based infinite scroll to Imbox, Feed, and Paper Trail so users can reach all their messages (currently capped at 50). Ensure unread threads always appear above read threads in Imbox.

## Problem Statement

1. **Can't see all messages** — Only 50 messages load per category. Users with more messages (e.g., 10+ unread) can't scroll to older ones.
2. **Unread visibility** — The "New For You" / "Previously Seen" split exists but breaks when there are many unread threads that overflow the viewport.

## Proposed Solution

Cursor-based pagination with `useInfiniteQuery` (React Query, already installed). SSR for the first page, client-side fetch for subsequent pages via a new API route.

### Architecture

```
┌─────────────────────────────────────────┐
│  Server Component (page.tsx)            │
│  - Fetches first page (50 messages)     │
│  - Passes as initialData to client      │
└──────────────┬──────────────────────────┘
               │ props
┌──────────────▼──────────────────────────┐
│  Client Component (InfiniteMessageList) │
│  - useInfiniteQuery with initialData    │
│  - IntersectionObserver on sentinel     │
│  - Incremental thread dedup via Map     │
│  - Imbox: splits unread/read sections   │
└──────────────┬──────────────────────────┘
               │ fetch on scroll
┌──────────────▼──────────────────────────┐
│  API Route: GET /api/messages           │
│  - Auth via auth()                      │
│  - Validated params (Zod)               │
│  - Returns: { messages, threadCounts,   │
│               nextCursor }              │
└─────────────────────────────────────────┘
```

### Key Design Decisions

**Thread collapsing across pages:** Incremental client-side dedup. The client maintains a persistent `Map<threadId, message>` across all loaded pages. When a new page arrives, only the new messages are processed — O(pageSize) per load, not O(totalMessages). When a later page reveals an unread message for an already-seen thread, the thread's `isRead` is updated to `false` and it moves to "New For You."

**Imbox two-section pagination:** Single cursor, client-side split. One API call returns messages sorted by `receivedAt desc`. The client separates them into "New For You" (unread) and "Previously Seen" (read). Since unread messages are finite (typically small), they're exhausted within the first few pages, after which all new pages append to "Previously Seen."

**AutoSync:** Leave `router.refresh()` as-is initially. In Next.js 15, `router.refresh()` re-renders server components without unmounting client components — the React Query cache survives. Test this assumption during implementation; only refactor to `queryClient.invalidateQueries` if scroll position is actually lost.

**Cursor stability:** The cursor encodes `receivedAt` + `id`. The query uses `WHERE (receivedAt, id) < (cursorDate, cursorId)`, which works even if the anchor row is archived — it's a positional comparison, not a row lookup.

**SSR-to-client hydration:** The server component fetches the first page and passes it as `initialData` to `useInfiniteQuery`, avoiding a redundant first-page fetch on hydration.

**API response shape:** Use `select` (not `include`) to return only list-view fields. Exclude `htmlBody`, `textBody`, `bccAddresses`. Include `threadCounts` in the response so badges work on all pages.

## Acceptance Criteria

- [x] Scrolling to the bottom of Imbox, Feed, or Paper Trail loads the next 50 messages automatically
- [x] Unread threads in Imbox always appear in "New For You" above "Previously Seen"
- [x] No duplicate threads appear across pages
- [x] Thread read state is correctly merged across pages (unread on page N updates thread from page 1)
- [x] Thread count badges display correctly on all pages (not just page 1)
- [x] Loading spinner shown at the bottom while fetching the next page
- [x] "You're all caught up" shown when all messages are loaded
- [x] Navigating to a thread and back preserves scroll position and loaded pages
- [x] New mail arriving (via AutoSync) does not reset scroll position
- [x] Empty states still work (0 messages in a category)
- [x] Archive action while scrolled deep removes the thread from the list immediately
- [x] Works for Imbox, Feed, and Paper Trail
- [x] API validates all input params (category, cursor, limit) and returns 400 on invalid
- [x] Search continues to work (renders non-paginated list when searching)

## Implementation Plan

### Phase 1: API Route & Database

**1.1 Create API route with validation**

`src/app/api/messages/route.ts`:

```typescript
import { z } from "zod";

const querySchema = z.object({
  category: z.enum(["imbox", "feed", "paper-trail"]),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CATEGORY_FILTERS = {
  imbox: { isInImbox: true },
  feed: { isInFeed: true },
  "paper-trail": { isInPaperTrail: true },
} as const;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const { category, cursor, limit } = parsed.data;
  const cursorCondition = cursor ? parseCursor(cursor) : undefined;
  if (cursor && !cursorCondition) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const messages = await db.message.findMany({
    where: {
      userId: session.user.id,
      ...CATEGORY_FILTERS[category],
      ...cursorCondition,
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      subject: true,
      snippet: true,
      fromAddress: true,
      fromName: true,
      receivedAt: true,
      isRead: true,
      isFlagged: true,
      hasAttachments: true,
      threadId: true,
      sender: { select: { displayName: true, email: true } },
    },
  });

  // Thread counts for this batch
  const threadCounts = await getThreadCounts(session.user.id, messages);

  const nextCursor =
    messages.length === limit
      ? encodeCursor(messages[messages.length - 1])
      : null;

  return NextResponse.json({
    messages,
    threadCounts: Object.fromEntries(threadCounts),
    nextCursor,
  });
}
```

Cursor helpers with validation:

```typescript
function encodeCursor(msg: { receivedAt: Date; id: string }): string {
  return `${msg.receivedAt.toISOString()}_${msg.id}`;
}

function parseCursor(cursor: string): Record<string, unknown> | null {
  const lastUnderscore = cursor.lastIndexOf("_");
  if (lastUnderscore === -1) return null;

  const dateStr = cursor.substring(0, lastUnderscore);
  const id = cursor.substring(lastUnderscore + 1);

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  if (!/^c[a-z0-9]{24,}$/.test(id)) return null;

  return {
    OR: [{ receivedAt: { lt: date } }, { receivedAt: date, id: { lt: id } }],
  };
}
```

Note: No `isArchived: false` filter needed — archived messages already have category flags cleared by `archiveConversation`. The category flag filter (`isInImbox: true`, etc.) is sufficient.

**1.2 Shared query function**

Export the core query logic from the API route file so page server components can import it for the first page (SSR). This ensures both paths use the exact same `select` and `where` clauses.

### Phase 2: Client Component

**2.1 Create `InfiniteMessageList` client component**

`src/components/mail/infinite-message-list.tsx`:

- Receives `initialMessages`, `initialCursor`, `initialThreadCounts`, `category` from server
- Inline `useInfiniteQuery` (no separate hook file — single consumer)
- Per-query overrides: `staleTime: 30_000`, `gcTime: 300_000`
- Incremental thread collapsing via persistent `Map<threadId, message>` ref
  - On new page: only process new messages, merge read state for existing threads
  - If a thread gains an unread message from a later page, update its `isRead` to `false`
- Accumulate `threadCounts` across pages in a `Map<messageId, number>` ref
- For Imbox (`showSections={true}`): split collapsed threads into unread/read sections
- For search: when `searchParams.q` is present, skip infinite scroll, render flat list
- Renders `<MessageRow>` for each thread (export from existing `message-list.tsx`)
- Sentinel `<div ref={sentinelRef} />` at the bottom triggers `fetchNextPage`
- Shows spinner while `isFetchingNextPage`
- Shows "You're all caught up" when `!hasNextPage`

**2.2 IntersectionObserver setup**

```typescript
useEffect(() => {
  if (!sentinelRef.current || !hasNextPage) return;
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) fetchNextPage();
    },
    { rootMargin: "0px 0px 200px 0px" }, // preload 200px before visible
  );
  observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [hasNextPage, fetchNextPage]);
```

**2.3 Archive integration**

After `archiveConversation` server action completes, invalidate the React Query cache:

```typescript
// In MessageRow, after archive action resolves:
queryClient.invalidateQueries({ queryKey: ["messages", category] });
```

### Phase 3: Integrate with Pages

**3.1 Refactor Imbox, Feed, Paper Trail pages**

Each page becomes a thin server component that fetches the first page and delegates to the client component:

`src/app/(mail)/imbox/page.tsx`:

```typescript
export default async function ImboxPage({ searchParams }) {
  const session = await auth();
  // ... auth check, redirect if needed

  const q = searchParams?.q?.trim();
  if (q) {
    // Search mode: non-paginated, use existing MessageList
    const results = await searchMessages(session.user.id, q, ...);
    return <MessageList messages={results} />;
  }

  // Paginated mode
  const { messages, threadCounts, nextCursor } = await getFirstPage(session.user.id, "imbox");

  return (
    <InfiniteMessageList
      initialMessages={messages}
      initialCursor={nextCursor}
      initialThreadCounts={threadCounts}
      category="imbox"
      showSections={true}
    />
  );
}
```

Same pattern for Feed and Paper Trail (with `showSections={false}`).

**3.2 Export `MessageRow` from `message-list.tsx`**

Export `MessageRow` as a named export so `InfiniteMessageList` can import and reuse it. Keep the existing `MessageList` component for search results.

### Phase 4: AutoSync (Deferred)

Leave `router.refresh()` as-is. Test during implementation whether it causes scroll position issues with the new client component. If it does, refactor to:

```typescript
const queryClient = useQueryClient();
queryClient.invalidateQueries({ queryKey: ["messages"] });
```

This is deferred because `router.refresh()` in Next.js 15 should preserve client component state.

## Files to Create/Modify

| File                                            | Action | Purpose                                          |
| ----------------------------------------------- | ------ | ------------------------------------------------ |
| `src/app/api/messages/route.ts`                 | Create | Paginated messages API with validation           |
| `src/components/mail/infinite-message-list.tsx` | Create | Client component with scroll + incremental dedup |
| `src/app/(mail)/imbox/page.tsx`                 | Modify | Use InfiniteMessageList, keep search as-is       |
| `src/app/(mail)/feed/page.tsx`                  | Modify | Use InfiniteMessageList                          |
| `src/app/(mail)/paper-trail/page.tsx`           | Modify | Use InfiniteMessageList                          |
| `src/components/mail/message-list.tsx`          | Modify | Export MessageRow                                |

## Dependencies & Risks

- **React Query is already installed** (`@tanstack/react-query@^5.62.11`) — no new dependencies needed.
- **Risk: Thread dedup across pages** — A thread could have messages split across pages. The incremental Map-based dedup handles this, including merging read state.
- **Risk: React Query staleTime/gcTime** — The global config has `staleTime: 0, gcTime: 0`. Use per-query overrides to scope changes to message queries only.

## Out of Scope

- Search result pagination (current 50-result cap is acceptable for now)
- Virtualized rendering (only needed if DOM exceeds ~300 threads)
- New database indexes (existing indexes are sufficient for single-user; profile first, optimize second)
- AutoSync refactor (deferred; test `router.refresh()` first)
