# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MM.DD`).

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
