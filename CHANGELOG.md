# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MM.DD`).

## [Unreleased]

### Added

- A third remote-image privacy mode: **Load images, block trackers**. In addition to "Block all remote images" (the default) and "Load all remote images", you can now load ordinary content images while still stripping known email trackers and invisible spy pixels (1×1 / 0px / `display:none` images). Detection runs before any network request fires, so blocked trackers never load. A new Privacy section in Settings → Mail lets you choose the mode, and tracked threads show a compact "N trackers blocked" indicator. Per-sender trust and the one-time "Load images" action continue to load everything.
  - **Self-hosting note:** this adds a `blockTrackers` column to the `User` table (default `true`). Because the production database shares its instance with another app, apply the change as explicit SQL rather than `prisma db push`: `ALTER TABLE "User" ADD COLUMN "blockTrackers" BOOLEAN NOT NULL DEFAULT true;` (e.g. `bin/deploy app exec --reuse "psql \"$DATABASE_URL\" -c '...'"`).

### Fixed

- Push notifications in the PWA now work reliably. The VAPID public key was inlined into the client bundle at build time while the private key was read (and could be auto-generated) at runtime, so the two could drift apart and pushes would silently fail to deliver. The public key is now served from a runtime endpoint, making the runtime environment the single source of truth for both keys. The settings screen now shows a clear message when subscribing fails or when push is not configured on the server, instead of a dead "Enable" button.
  - **Self-hosting note:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is no longer a Docker build argument — it is read at runtime like `VAPID_PRIVATE_KEY`. Ensure both keys are present as runtime environment variables (and unchanged across deploys); a build-arg-only configuration will now serve no public key.

## [v2026.06.10] - 2026-06-10

### Changed

- Archiving a thread from the thread view is now instant. It navigates back to the list immediately instead of freezing the UI for a few seconds while the server action completes.

### Fixed

- New mail (including login codes) now arrives within seconds. IMAP IDLE events were being dropped while a full sync held the sync lock, and IDLE connections only started lazily on the first sync job after a restart; they now defer-and-retry under the lock and start at boot with a downtime catch-up.
- Removed a faint extra border on undo toasts.

## [v2026.06.04] - 2026-06-04

### Changed

- Removed initial-circle avatars app-wide, including the remaining ones in screener sender lists.

### Fixed

- Snooze: preserve read state so only unread mail is marked unread on wake.
- Scheduled messages: prevent double-send when using "Send now" within the undo window.

## [v2026.06.03] - 2026-06-03

### Added

- Contact groups: organize contacts into named groups.
- Compose: support multiple recipients in both immediate and scheduled sends.

### Changed

- Reading pane: editorial redesign with a serif subject line and calmer avatars.
- Message list: cleaner rows that reserve brand color for signal.
- Sidebar: refreshed with cleaner design tokens, extended to the mobile tab bar.
- Toast: unified pop-up notification styling across all notification types.
- Compose: editing a scheduled message now returns to the origin view on cancel.

## [v2026.05.31] - 2026-05-31

### Added

- Attachments: PDF previews now render inline on iOS via pdfjs, where the native iframe viewer fails.

### Fixed

- Snooze: corrected the snooze label shown on snoozed messages.
- Categorization: archiving a message no longer leaks it into Reply Later or Follow-Up.
- Badge preferences: fixed an authorization check on the badge-preferences endpoint.
- Mobile (PWA): restored desktop/PWA navigation parity on the mobile tab bar.

## [v2026.05.30.2] - 2026-05-30

### Added

- Reply Later: stack messages you want to get back to and work through them in a dedicated focus mode, one at a time.
- Privacy: a spy-tracker blocker that strips tracking pixels and proxies remote images so senders can’t see when or where you open their mail.

### Fixed

- Mobile (PWA): vertical scrolling in list views no longer accidentally triggers swipe-to-archive — only deliberate horizontal swipes archive a row.

## [v2026.05.30] - 2026-05-30

### Added

- Files library: a new read-only `/files` page that browses every attachment across your mail, newest first. Filter by type (images, documents, archives, other), search by filename, and page through with "Load more". Jump to it with the `g+l` keyboard shortcut. Downloads reuse the existing attachment route.
- Mobile (PWA): attachments now open through the native iOS share sheet, so you can save to Files, share to other apps, or AirDrop directly.

### Fixed

- Mobile (PWA): the app no longer freezes during bursts of realtime activity. All refreshes now route through a single debounced scheduler that coalesces SSE event storms, and the realtime connection is tied to tab visibility (closed when backgrounded, reconnected with a single refresh on resume) so iOS no longer replays buffered events into a refresh storm on app resume.

## [v2026.05.20] - 2026-05-20

### Added

- Un-thread emails from noisy senders. Toggle in the thread detail header next to the message count: each message from that sender renders as its own row in list views and opens a single-message detail view. Reversible at any time; no data is mutated.

### Fixed

- Mobile (PWA): iOS swipe-back and other user-initiated back gestures now navigate back to the list instead of being silently swallowed. Top-level pages still resist accidental edge-swipes that would exit the app.
- Mobile: toasts now sit above the bottom tab bar and the thread action bar instead of being hidden behind them — the Undo button inside an undo-toast is finally reachable.

## [v2026.05.15] - 2026-05-15

### Fixed

- Compose preview: paragraph breaks in the markdown preview now render correctly.

## [v2026.04.26.3] - 2026-04-26

### Fixed

- Reply composer now preserves a custom To address when you press Enter or click away — useful when you want to forward a reply to someone else. Previously the field reset back to the original sender as soon as editing finished.

## [v2026.04.26.2] - 2026-04-26

### Changed

- Email body now renders in a Shadow DOM instead of an iframe. The content shows up in the same paint (no more pop-in flash after a beat) and on mobile the page scrolls naturally because touch gestures are no longer trapped by the iframe. CSS isolation and the sanitizer guarantees are unchanged.

## [v2026.04.26] - 2026-04-26

### Changed

- Mobile thread view: hide the duplicate header action buttons in Imbox / Feed / Paper Trail so the bottom action bar is the single archive/snooze/follow-up surface on phones.
- Swipe-left on a message row now snoozes to tomorrow 8 AM local with a 5-second undo toast, instead of opening a popover anchored to a hidden element. The snooze picker is still available via the keyboard `s` shortcut and the desktop hover button.

### Fixed

- Imbox / Feed / Paper Trail no longer show stale list data after approving, rejecting, or recategorizing a sender — the React Query messages cache is invalidated alongside the existing server-side `revalidatePath`.

## [v2026.04.21] - 2026-04-21

### Added

- Reply All with Cc and Bcc support. Compact "Reply all" trigger chip inside the reply button, editable Cc/Bcc rows with `+ Add Cc` / `+ Add Bcc` affordances, and a new keyboard shortcut `a` for reply-all.

### Changed

- Upgraded major dependencies: Next.js 15 → 16, Prisma 6 → 7, Tailwind CSS 3 → 4, TypeScript 5 → 6, Zod 3 → 4, ESLint 9 → 10, framer-motion → motion 12.

### Fixed

- Deploy: Prisma 7 compatibility — added `prisma.config.ts`, dropped the removed `--skip-generate` flag from the entrypoint and post-deploy hook, symlinked global `prisma` so the config file resolves inside the runner image.
- Deploy: extended healthcheck timeout to 120s so Next.js 16 cold boots don't roll back.
- Build: replaced pre-existing invalid `"outline-solid"` Button variants that blocked the Next.js 16 type-check.

---

Earlier versions are tracked in the [GitHub releases page](https://github.com/cfarvidson/kurir-server/releases).
