# Follow-up Reminders & Contact Sidebar

**Date:** 2026-03-18
**Status:** Ready for planning

---

## What We're Building

### Feature 1: Follow-up Reminders

A per-thread reminder system that surfaces threads where the user is waiting for a reply. The user explicitly sets a follow-up deadline ("remind me if no reply in 3 days"). If no reply arrives by the deadline, the thread appears in a dedicated "Follow Up" sidebar section with a badge count. If a reply comes in before the deadline, the reminder auto-cancels silently.

**User flow:**

1. User sends a reply or reads a thread they want to track
2. Clicks "Follow Up" button (next to Snooze) → preset picker appears (1 day, 3 days, 1 week, 2 weeks)
3. System stores `followUpAt` timestamp on the thread's messages
4. Background sync loop checks every 60s: is `followUpAt` past AND no newer incoming message in thread?
5. If yes → set `isFollowUp = true`, thread appears in /follow-up view with badge
6. If a reply arrives before deadline → auto-clear `followUpAt` (no reminder fires)
7. In /follow-up view, user can **dismiss** (clear reminder) or **extend** (push deadline forward)

### Feature 2: Contact Sidebar

A compact, always-visible right panel (~280px) in the thread detail view showing context about the sender. Desktop only (hidden below `lg` breakpoint). Shows sender name, email, category badge, message count, first/last email dates, and the 5 most recent threads with this contact. Links to the full `/contacts/[id]` page.

**User flow:**

1. User opens any thread
2. Right panel shows sender info, pulled from the Sender model
3. Recent threads listed as clickable links
4. "View all" link goes to existing contact detail page

---

## Why This Approach

### Follow-up Reminders: Extend the snooze pattern

The snooze system already provides the exact infrastructure: per-message date fields, a background sync loop that checks expiry, picker components, and a dedicated sidebar view. Follow-up reminders are the inverse of snooze — instead of "hide until X", it's "surface if no reply by X". Reusing this pattern means:

- Minimal new schema (2 fields on Message)
- Reuse `SnoozePicker` component with different presets
- Reuse background sync loop pattern (`wakeExpiredSnoozes` → `checkExpiredFollowUps`)
- Same sidebar + badge pattern as Snoozed view
- Auto-cancel leverages existing IMAP sync thread detection

**Alternative considered:** Auto-tracking all sent messages. Rejected because it creates noise — most emails don't need follow-up tracking, and the user knows which threads matter.

### Contact Sidebar: Server component in thread layout

The existing `/contacts/[id]` page already queries everything needed. The sidebar is a compact, read-only excerpt rendered as a server component alongside the thread. No new API routes or client-side state needed.

**Alternative considered:** Hover card on sender name. Rejected because the user wants persistent context, not ephemeral popups. The always-visible panel provides ambient awareness without extra clicks.

---

## Key Decisions

1. **Explicit per-thread triggers** — User sets follow-up reminders manually, not auto-tracked
2. **Preset delays only** — Reuse snooze-style picker (1d, 3d, 1w, 2w), no custom input
3. **Auto-cancel on reply** — If incoming message arrives in thread before deadline, reminder clears silently
4. **Dedicated /follow-up view** — New sidebar section with badge, same pattern as Snoozed
5. **Dismiss + Extend actions** — Two actions in follow-up view: clear reminder or push deadline
6. **Always-visible sidebar** — Right panel on desktop, hidden on mobile
7. **Narrow panel (~280px)** — Compact layout: avatar, name, email, category, dates, recent threads
8. **First/last email dates** — Temporal context computed from message history
9. **5 most recent threads** — Reuse `collapseToThreads` from contacts page

---

## Open Questions

1. **Follow-up badge color** — Should it use the same primary color as other badges, or a distinct color (e.g. orange/amber) to signal urgency?
2. **Sidebar for multi-participant threads** — If a thread has multiple external senders, which contact shows in the sidebar? The original sender? The most recent?
3. **Follow-up on sent-only threads** — Should the follow-up button appear on sent mail views too, or only in Imbox/Feed/Paper Trail?
4. **Sidebar on mobile** — Completely hidden, or accessible via a "Contact info" button in the thread header?

---

## Schema Changes (Preview)

```prisma
// On Message model — new fields
followUpAt   DateTime?  // Deadline for follow-up reminder
isFollowUp   Boolean    @default(false)  // True when reminder has fired

// New index
@@index([userId, isFollowUp])
@@index([userId, followUpAt])
```

## Components (Preview)

```
Follow-up Reminders:
- src/components/mail/follow-up-button.tsx     (reuse SnoozePicker)
- src/actions/follow-up.ts                     (set/dismiss/extend)
- src/app/(mail)/follow-up/page.tsx            (dedicated view)
- background-sync.ts → checkExpiredFollowUps() (new function)
- sync-service.ts → auto-cancel on new reply   (small addition)

Contact Sidebar:
- src/components/mail/contact-sidebar.tsx       (server component)
- src/lib/mail/contact-context.ts              (query helper)
- thread-detail-view.tsx → add sidebar to layout
```
