# Auto-Approve Own Email Address

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

The user's own email address should never appear as a PENDING sender in the Screener. Currently, `getOrCreateSender()` creates all new senders with `status: "PENDING"`, including the user's own address. This means if the user sends themselves an email (or messages from their address land in INBOX for any reason), their own address shows up in the Screener alongside unknown senders.

**Desired behavior:** Auto-approve the user's own email address as an IMBOX sender so it's treated like a trusted contact from the start.

## Why This Approach

**Modify `getOrCreateSender()` to detect the user's own email and create with `status: "APPROVED"`, `category: "IMBOX"`.**

- Solves the problem at the root — the sender record is never PENDING
- Single point of change — all code paths that create senders go through this function
- The user's email is already available in the sync flow (`userEmail` param in `syncMailbox`)
- Existing messages from own address also get correctly categorized via `processMessage()` since the sender will be APPROVED

**Rejected alternatives:**
- Only fix `processMessage()` flags — leaves the Sender record as PENDING, which is inconsistent and would still show in Screener's sender list query
- Fix at sync-start — more complex, doesn't cover all code paths (e.g., future reply/compose flows)

## Key Decisions

- **Only the primary email address** — no alias handling needed for now
- **Category: IMBOX** — messages from own address go to Imbox, not Feed or Paper Trail
- **Retroactive fix needed** — existing PENDING sender record for own email should be updated (one-time migration or handled on next sync)

## Open Questions

- Should this also handle the case where a user changes their email address? (Likely YAGNI for now)
