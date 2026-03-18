title: Follow-up Reminders & Contact Sidebar
type: feat
date: 2026-03-18

# Follow-up Reminders & Contact Sidebar

## Overview

Two complementary features that improve email workflow:

1. **Follow-up Reminders** — Per-thread reminder system that surfaces threads where the user is waiting for a reply. Explicit trigger, preset delays, auto-cancel on incoming reply, dedicated sidebar view with dismiss + extend actions.

2. **Contact Sidebar** — Always-visible ~280px right panel in thread detail view (desktop only) showing sender context: name, email, category badge, message count, first/last email dates, and 5 most recent threads.

Both features reuse existing infrastructure (snooze pattern, contacts queries, background sync loop).

## Problem Statement / Motivation

**Follow-up Reminders:** Users send important emails and lose track of which threads need replies. Currently there is no way to track "waiting for reply" threads — they either stay in Imbox (mental overhead) or get archived and forgotten.

**Contact Sidebar:** When reading a thread, the user has no ambient context about the sender — how many emails they've exchanged, when they first communicated, or what other conversations they've had. The existing `/contacts/[id]` page has this data but requires explicit navigation.

---

## Feature 1: Follow-up Reminders

### Schema Changes

```prisma
// On Message model — 3 new fields
followUpAt      DateTime?  // Deadline for follow-up reminder
followUpSetAt   DateTime?  // When the reminder was set (for auto-cancel comparison)
isFollowUp      Boolean    @default(false)  // True when reminder has fired

// New indexes
@@index([userId, isFollowUp])
@@index([userId, followUpAt])
```

> **Why `followUpSetAt`?** The auto-cancel check needs to know *when* the reminder was set to distinguish pre-existing replies from new ones. Without it, a thread with an old reply would immediately cancel a newly set follow-up.

### User Flows

**Setting a follow-up:**
1. User opens any thread (Imbox, Feed, Paper Trail, Sent, Archive)
2. Clicks "Follow Up" button in thread header actions bar
3. Preset picker appears: **1 day, 3 days, 1 week, 2 weeks**
4. Server action sets `followUpAt` and `followUpSetAt` on all thread messages
5. Toast: "Following up in 3 days" — user stays on thread (no navigation)
6. `revalidateTag("sidebar-counts")`

**Background check fires reminder:**
1. `syncAndNotify()` runs every 60s
2. `checkExpiredFollowUps(userId)` queries messages where `followUpAt <= now()` AND `isFollowUp = false`
3. For each matching thread: check if any incoming message exists with `receivedAt > followUpSetAt` AND `fromAddress != userEmail`
4. If no such reply → set `isFollowUp = true` on all thread messages
5. Optional: emit SSE `follow-up-fired` event for toast notification

**Auto-cancel on reply (two locations):**
1. **In `processMessage()`** (sync-service.ts): After persisting a new incoming message, check if the thread has `followUpAt` set. If yes, clear `followUpAt` and `followUpSetAt` on all thread messages. This provides immediate cancellation.
2. **In `checkExpiredFollowUps()`** (background-sync.ts): As a safety net, also check for newer replies before firing. This catches replies that arrived between sync cycles.

**Auto-clear fired follow-ups on late reply:**
- If a new incoming message arrives in a thread where `isFollowUp = true`, auto-clear `isFollowUp`, `followUpAt`, and `followUpSetAt`. The thread disappears from /follow-up.

**Viewing /follow-up:**
1. User clicks "Follow Up" in sidebar navigation
2. Page queries `{ isFollowUp: true }` via `CATEGORY_FILTERS`, collapses to threads
3. Each thread shows subject, snippet, and how long overdue
4. Two actions per thread: **Dismiss** and **Extend**

**Dismiss:**
- Sets `isFollowUp = false`, clears `followUpAt` and `followUpSetAt`
- Thread disappears from /follow-up view

**Extend:**
- Opens picker with same presets (1d, 3d, 1w, 2w from *now*)
- Sets `isFollowUp = false`, sets new `followUpAt` and `followUpSetAt`
- Thread returns to "waiting" state

**Cancel pending (not yet fired) follow-up:**
- If a thread has `followUpAt` set but `isFollowUp` is still `false`, the follow-up button shows in "active" state (amber icon, "Following up in 2 days" tooltip)
- Clicking reveals: "Cancel follow-up" and "Change deadline"

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Stay on thread after setting | Yes, show toast | Unlike snooze (which hides the thread), follow-up doesn't change visibility |
| Follow-up in Sent view | Yes | Primary use case — "I sent this, remind me if no reply" |
| Badge color | Amber/orange | Distinct from primary coral, signals "needs attention" |
| Always show in sidebar | Yes (like Snoozed) | Feature needs to be discoverable |
| Follow-up + Snooze | Independent | Thread can appear in /follow-up even while snoozed |
| Follow-up + Archive | Follow-up still fires | User explicitly set it; archiving doesn't cancel intent |
| User's own reply | Does NOT cancel | User is still waiting for the *other* person |
| Auto-clear fired on late reply | Yes | Keeps /follow-up clean; mirrors mental model |
| Extend presets | Relative to now | "Check again tomorrow" is more intuitive than "4 days after original" |

### Visual Indicator in List Views

Show a small bell icon (`Bell` from lucide-react) next to threads with `followUpAt` set (pending, not yet fired) in any list view (Imbox, Feed, etc.). This gives ambient awareness of tracked threads.

### Navigation & Badge

- New nav entry: "Follow Up" with `Bell` icon, placed after "Snoozed"
- `badgeKey: "followUp"` added to `NavItem` union type
- `getFollowUpCount` cached query in layout.tsx: count distinct `threadId` where `isFollowUp = true`
- Amber badge styling to differentiate from other counts

### New Files

```
src/actions/follow-up.ts                     — setFollowUp, dismissFollowUp, extendFollowUp, cancelFollowUp
src/components/mail/follow-up-picker.tsx     — Adapted from SnoozePicker with relative presets
src/components/mail/follow-up-button.tsx     — Wraps picker, shows active state when pending
src/app/(mail)/follow-up/page.tsx            — List view (mirrors /snoozed)
src/app/(mail)/follow-up/[id]/page.tsx       — Thread detail with dismiss/extend actions
```

### Modified Files

```
prisma/schema.prisma                         — 3 new fields + 2 indexes on Message
src/lib/mail/background-sync.ts              — Add checkExpiredFollowUps() after wakeExpiredSnoozes
src/lib/mail/sync-service.ts                 — Auto-cancel in processMessage() on incoming reply
src/lib/mail/messages.ts                     — Add "follow-up" to CATEGORY_FILTERS, followUpAt to MESSAGE_SELECT
src/components/layout/navigation.ts          — New nav entry, expand badgeKey union
src/components/layout/sidebar.tsx            — Accept + display followUpCount prop
src/app/(mail)/layout.tsx                    — Add getFollowUpCount cached query
src/app/(mail)/imbox/[id]/page.tsx           — Add FollowUpButton to actions
src/app/(mail)/feed/[id]/page.tsx            — Add FollowUpButton to actions
src/app/(mail)/paper-trail/[id]/page.tsx     — Add FollowUpButton to actions
src/app/(mail)/sent/[id]/page.tsx            — Add FollowUpButton to actions
src/app/(mail)/archive/[id]/page.tsx         — Add FollowUpButton to actions
src/lib/mail/sse-subscribers.ts              — Add follow-up-fired event type (optional)
```

### Performance Consideration

The `checkExpiredFollowUps` background query needs to avoid N+1 for the "check for newer replies" subquery. Use a single raw SQL query with `NOT EXISTS` correlated subquery:

```sql
UPDATE "Message" SET "isFollowUp" = true
WHERE "userId" = $1
  AND "followUpAt" <= NOW()
  AND "isFollowUp" = false
  AND NOT EXISTS (
    SELECT 1 FROM "Message" m2
    WHERE m2."threadId" = "Message"."threadId"
      AND m2."userId" = $1
      AND m2."receivedAt" > "Message"."followUpSetAt"
      AND m2."fromAddress" != $2
      AND m2."isInbox" = true
  )
```

### Race Condition Mitigation

If a reply arrives at nearly the same time the deadline expires, `processMessage` and `checkExpiredFollowUps` could race. Mitigation:
- `processMessage` clears `followUpAt` first (immediate), then `checkExpiredFollowUps` won't match (since `followUpAt` is null)
- If `checkExpiredFollowUps` runs first and sets `isFollowUp = true`, then `processMessage` runs and clears both `isFollowUp` and `followUpAt` — correct final state

---

## Feature 2: Contact Sidebar

### User Flow

1. User opens any thread on desktop (viewport >= `lg` / 1024px)
2. Right panel (~280px) renders alongside thread content
3. Panel shows:
   - Avatar with color-hashed background (reuse existing pattern)
   - Display name + email
   - Category badge (IMBOX / FEED / PAPER_TRAIL) or "Awaiting decision" for PENDING
   - Message count
   - First email date + last email date
   - 5 most recent threads (clickable, route-aware links)
   - "View all" link → `/contacts/[id]`
4. Below `lg` breakpoint: sidebar hidden entirely. Small "info" icon in thread header links to `/contacts/[id]`

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Multi-participant threads | Show original sender (first message `fromAddress`) | Stable, predictable — thread originator is most relevant |
| Sent-only threads | Show primary recipient (first `toAddresses` entry) | User wants context about who they wrote to, not themselves |
| Screener threads | Show limited sidebar for PENDING senders | Helps user decide whether to approve |
| No Sender record | Graceful fallback: show email + "Unknown contact" | Don't crash; degrade gracefully |
| Recent threads routing | Determine route from message category flags | Fix existing hardcoded `/imbox/` bug in ContactThreadList |
| Recent threads scope | All categories including archived | More history is more useful |
| Mobile access | "Info" icon button in thread header → `/contacts/[id]` | Low effort, good discoverability |

### Layout Change

`ThreadDetailView` needs restructuring from single-column to two-column:

```
Before:
┌─────────────────────────────────────────┐
│ sticky header (back, category, actions) │
├─────────────────────────────────────────┤
│         thread content (max-w-3xl)      │
│              centered                   │
└─────────────────────────────────────────┘

After (desktop):
┌─────────────────────────────────────────────────────┐
│ sticky header (back, category, actions)              │
├───────────────────────────────────┬─────────────────┤
│    thread content (flex-1)        │ contact sidebar  │
│    overflow-auto                  │ w-[280px]        │
│                                   │ overflow-auto    │
│                                   │ border-l         │
│                                   │ hidden < lg      │
└───────────────────────────────────┴─────────────────┘
```

The sidebar is an **optional prop** on `ThreadDetailView` so pages can opt in/out. The sidebar component is a server component — no client-side state needed.

### Contact Context Query

New helper `getContactContext(userId, email)` in `src/lib/mail/contact-context.ts`:

```typescript
// Returns: sender record + first/last dates + 5 recent threads
// - Sender via db.sender.findFirst({ where: { userId, email } })
// - First/last dates via db.message.aggregate({ where: { userId, fromAddress: email }, _min: { receivedAt }, _max: { receivedAt } })
// - Recent threads via db.message.findMany + collapseToThreads (limit 5)
```

### New Files

```
src/components/mail/contact-sidebar.tsx      — Server component rendering sidebar content
src/lib/mail/contact-context.ts              — getContactContext() query helper
```

### Modified Files

```
src/components/mail/thread-detail-view.tsx   — Two-column layout, optional contactSidebar prop
src/app/(mail)/imbox/[id]/page.tsx           — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/feed/[id]/page.tsx            — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/paper-trail/[id]/page.tsx     — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/sent/[id]/page.tsx            — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/archive/[id]/page.tsx         — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/snoozed/[id]/page.tsx         — Pass ContactSidebar to ThreadDetailView
src/app/(mail)/follow-up/[id]/page.tsx       — Pass ContactSidebar to ThreadDetailView (new page)
src/components/contacts/contact-thread-list.tsx — Fix hardcoded /imbox/ links to be route-aware
```

### Performance Note

The sidebar adds 2-3 DB queries per thread page load (sender lookup, date aggregation, recent threads). These can run in `Promise.all` alongside the existing thread queries in `ThreadDetailView` to avoid sequential latency.

---

## Implementation Order

### Phase 1: Follow-up Reminders (larger scope, more integration points)

1. Schema: Add 3 fields + 2 indexes to Message model, `pnpm db:push`
2. Server actions: `src/actions/follow-up.ts` (set, dismiss, extend, cancel)
3. Background sync: `checkExpiredFollowUps()` in background-sync.ts
4. Auto-cancel: Hook into `processMessage()` in sync-service.ts
5. Picker + button components
6. Navigation: nav entry, badge key, sidebar count
7. `/follow-up` page + `[id]` detail page
8. Add FollowUpButton to all thread detail pages (imbox, feed, paper-trail, sent, archive)
9. Visual indicator (bell icon) in list views for pending follow-ups

### Phase 2: Contact Sidebar (read-only, fewer moving parts)

1. `getContactContext()` query helper
2. `ContactSidebar` server component
3. `ThreadDetailView` layout restructure (two-column with optional sidebar)
4. Wire sidebar into all thread detail pages
5. Fix `ContactThreadList` route-aware links
6. Mobile: info button in thread header

---

## Acceptance Criteria

### Follow-up Reminders

- [x] User can set follow-up from thread detail view in Imbox, Feed, Paper Trail, Sent, Archive
- [x] Presets: 1 day, 3 days, 1 week, 2 weeks — no custom input
- [x] User stays on thread after setting; toast confirms
- [x] Follow-up button shows "active" state when pending, with cancel/change options
- [x] Background check fires reminder when deadline passes with no incoming reply
- [x] Auto-cancel: incoming reply before deadline silently clears follow-up
- [x] Auto-clear: incoming reply after fired follow-up clears `isFollowUp`
- [x] User's own outgoing reply does NOT cancel follow-up
- [x] /follow-up page lists fired follow-ups with dismiss + extend actions
- [x] Dismiss clears reminder completely
- [x] Extend opens picker, resets deadline relative to now
- [x] Sidebar badge shows count of fired follow-ups in amber/orange
- [x] "Follow Up" nav entry always visible (like Snoozed)
- [ ] Bell icon in list views for threads with pending follow-ups
- [x] Follow-up works independently of snooze (can be both snoozed + followed up)
- [x] Archived threads with follow-up still fire

### Contact Sidebar

- [x] ~280px right panel visible on desktop (>= lg breakpoint)
- [ ] Hidden below lg breakpoint; "info" button in thread header links to `/contacts/[id]`
- [x] Shows: avatar, display name, email, category badge, message count, first/last dates
- [x] Shows 5 most recent threads as clickable links with correct category routes
- [x] "View all" link navigates to `/contacts/[id]`
- [x] Multi-participant threads: shows original sender (thread originator)
- [x] Sent-only threads: shows primary recipient
- [x] PENDING senders: shows limited info with "Awaiting decision" status
- [x] No Sender record: graceful fallback with email + "Unknown contact"
- [x] Sidebar renders as server component (no client state)
- [x] Sidebar queries run in parallel with thread queries (no sequential latency)

---

## References

### Brainstorm
- `docs/brainstorms/2026-03-18-followup-reminders-and-contact-sidebar-brainstorm.md`

### Key Existing Patterns (to replicate)
- Snooze schema: `prisma/schema.prisma:271-272`
- `wakeExpiredSnoozes`: `src/lib/mail/background-sync.ts:60-74`
- Snooze actions: `src/actions/snooze.ts:7-148`
- `SnoozePicker`: `src/components/mail/snooze-picker.tsx:1-267`
- `CATEGORY_FILTERS`: `src/lib/mail/messages.ts:4-10`
- Sidebar badge system: `src/components/layout/sidebar.tsx:53-57`
- Badge count caching: `src/app/(mail)/layout.tsx:29-53`
- Navigation config: `src/components/layout/navigation.ts:1-31`
- Contact detail page: `src/app/(mail)/contacts/[id]/page.tsx:16-46`
- `collapseToThreads`: `src/lib/mail/threads.ts:170-197`
- `ThreadDetailView`: `src/components/mail/thread-detail-view.tsx:47-182`
- `processMessage`: `src/lib/mail/sync-service.ts:394-615`

### Institutional Learnings
- Atomic concurrency guard pattern: `docs/solutions/performance-issues/sync-timeout-on-large-mailboxes.md`
- Deferred IMAP operations: `docs/solutions/feature-implementations/auto-archive-rejected-screener-messages.md`
- Thread routing: `ContactThreadList` hardcodes `/imbox/` — needs fixing for sidebar
