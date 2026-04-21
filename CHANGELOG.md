# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MM.DD`).

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
