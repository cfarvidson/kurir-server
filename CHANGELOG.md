# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MM.DD`).

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
