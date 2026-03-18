---
title: "feat: Add schedule send to thread replies"
type: feat
date: 2026-03-18
---

# Add Schedule Send to Thread Replies

## Overview

The "Send Later" / schedule send feature currently only works from the Compose page. It should also be available when replying to a thread via the ReplyComposer.

## Current State

- **Backend: fully ready.** `createScheduledMessage()` already accepts `inReplyToMessageId` and `references` fields. `sendScheduledMessageNow()` already resolves thread context (threadId, references) when sending. The `ScheduledMessage` model has all the necessary fields.
- **Compose UI: done.** `compose-client.tsx` has a `SchedulePicker` button next to Send.
- **Reply UI: missing.** `reply-composer.tsx` only has Send and Cancel buttons. No schedule option.

## Proposed Solution

Add the `SchedulePicker` component to the `ReplyComposer` footer, mirroring the compose page pattern. Thread context (RFC 2822 `messageId`, `references`, `subject`, `emailConnectionId`) must be threaded through from `ThreadDetailView` → `ThreadPageContent` → `ReplyComposer`.

## Implementation

### 1. Thread data from `ThreadDetailView` to `ReplyComposer`

`ThreadDetailView` (server component) already has `lastMessage` with all fields from Prisma (`messageId`, `references`, `emailConnectionId`). Pass these down through `ThreadPageContent` as new props.

**`src/components/mail/thread-detail-view.tsx`:**
- Pass to `ThreadPageContent`: `subject`, `emailConnectionId` (from `targetMessage`), `rfcMessageId` (from `lastMessage.messageId`), `references` (from `lastMessage.references`), `userTimezone` (from `userInfo.timezone`)

**`src/components/mail/thread-page-content.tsx`:**
- Add new props to interface: `subject`, `emailConnectionId`, `rfcMessageId`, `references`, `userTimezone`
- Pass them through to `ReplyComposer`

### 2. Add SchedulePicker to `ReplyComposer`

**`src/components/mail/reply-composer.tsx`:**
- Add new props: `subject`, `emailConnectionId`, `rfcMessageId`, `references`, `userTimezone`
- Import `SchedulePicker` and `createScheduledMessage`
- Add `handleScheduleSend(scheduledFor: Date)` handler that:
  - Calls `createScheduledMessage()` with `to`, `subject` (prefixed with "Re: " if not already), `textBody`, `scheduledFor`, `emailConnectionId`, `inReplyToMessageId` (from `rfcMessageId`), `references` (joined with space)
  - Shows success toast
  - Collapses composer
- Add `CalendarClock` icon button in the footer next to Send, wrapping `SchedulePicker`
- The footer layout becomes: `[keyboard hint]` ... `[SchedulePicker] [Send]`

### 3. UX Details

- After scheduling a reply: show `toast.success("Reply scheduled")`, collapse the composer (stay on thread page — don't redirect like compose does)
- The SchedulePicker opens above the footer (side="top") so it doesn't get cut off at the bottom of the page
- While scheduling is in progress, both Send and Schedule buttons are disabled
- Error handling: `toast.error()` on failure, keep composer open with body preserved

## Acceptance Criteria

- [x] SchedulePicker button appears in ReplyComposer footer next to Send (`reply-composer.tsx`)
- [x] Clicking a preset or custom time creates a ScheduledMessage with correct `inReplyToMessageId` and `references` (`reply-composer.tsx`)
- [x] Scheduled reply appears in `/scheduled` page with correct subject and recipient (`scheduled-message-list.tsx` — already works)
- [x] When the scheduled time arrives, the reply is sent with correct thread headers (In-Reply-To, References) (`scheduled-send.ts` — already works)
- [x] Success toast shown after scheduling; composer collapses (`reply-composer.tsx`)
- [x] Both Send and Schedule disabled while scheduling is in progress (`reply-composer.tsx`)

## Files to Modify

1. `src/components/mail/thread-detail-view.tsx` — pass thread metadata + timezone as new props to `ThreadPageContent`
2. `src/components/mail/thread-page-content.tsx` — accept and forward new props to `ReplyComposer`
3. `src/components/mail/reply-composer.tsx` — add `SchedulePicker`, `handleScheduleSend`, new props

## Files Already Working (No Changes Needed)

- `src/actions/scheduled-messages.ts` — already accepts `inReplyToMessageId` + `references`
- `src/lib/mail/scheduled-send.ts` — already sends with correct thread headers
- `src/components/mail/schedule-picker.tsx` — reusable component, no changes needed
- `src/components/mail/scheduled-message-list.tsx` — already displays all scheduled messages
- `prisma/schema.prisma` — `ScheduledMessage` model already has reply fields
