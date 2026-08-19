# Changelog

All notable changes to Kurir are documented here. Versioning follows CalVer (`YYYY.MM.DD`).

## [Unreleased]

## [v2026.08.19.3] - 2026-08-19

### Changed

- Inbox hover actions now spell out Follow up, Snooze and Archive instead of
  anonymous F/S/E glyphs. Hidden until hover.

## [v2026.08.19.2] - 2026-08-19

### Fixed

- APNs alert payloads now set `content-available` so a running iOS or
  Mac app can sync incoming mail without the user focusing the window.

## [v2026.08.19] - 2026-08-19

### Added

- Reply drafts (including those saved via MCP) show the original sender
  and subject in Drafts instead of an empty "(no subject)" row.
- Opening a reply draft lands on the thread in the right folder with the
  reply composer already open on the saved text.
- MCP `get_thread` returns the in-progress reply draft. `save_draft` for
  a reply requires a real message id, not a thread id.

## [v2026.08.18.4] - 2026-08-18

### Added

- Large attachments can be uploaded in chunks via MCP `upload_attachment`
  and JSON `POST /api/attachments/upload`. Slice raw file bytes (not a
  base64 string), about 250 KB per call. A 1.5 MB PDF no longer has to
  travel as one tool argument.

## [v2026.08.18.3] - 2026-08-18

### Fixed

- Opening a draft no longer shows a fake Attachment 0 B chip. Filename and
  size come from the stored attachment row.
- Saving or deleting a draft (including via MCP) invalidates the web Drafts
  page so it matches the Mac app instead of a stale cache.

## [v2026.08.18.2] - 2026-08-18

### Fixed

- MCP attachments no longer land as empty 0-byte files. Small PDFs are
  inlined as base64, uploads accept data URLs and base64url, and empty
  stored bytes are treated as missing so IMAP can fetch the real part.

## [v2026.08.18] - 2026-08-18

### Fixed

- MCP attachments no longer land as empty 0-byte files. Small PDFs are
  inlined as base64, uploads accept data URLs and base64url, and empty
  stored bytes are treated as missing so IMAP can fetch the real part.

## [v2026.08.17.2] - 2026-08-17

### Fixed

- Settings backup Off / Daily / Weekly stay clickable after you pick one.
  Changing cadence no longer refetches the whole Settings page.

## [v2026.08.17] - 2026-08-17

### Added

- Settings takeout stored as a dummy Sent email (no SMTP). The attached
  JSON holds contacts, groups, screener decisions, domain rules, per-sender
  flags, and mail preferences - never message bodies. Backup now, or
  schedule daily/weekly at 03:00 local. The last 4 copies are kept.
  After a fresh install, pick a backup from Sent in setup or restore later
  from Settings. Scheduled success requires IMAP APPEND so the copy
  survives a wipe.

## [v2026.08.16.5] - 2026-08-16

### Changed

- The Docker image now carries the Kamal `service=kurir` label, so the
  CI-built `ghcr.io/cfarvidson/kurir-server:vX` image can be rolled out with
  `bin/deploy deploy --skip-push --version vX` instead of a local build and
  push. Release docs and CLAUDE.md describe the ghcr.io registry and the new
  deploy command

## [v2026.08.16.4] - 2026-08-16

### Fixed

- Sending a mail now deletes its originating draft server-side.
  `POST /api/mail/send` and the MCP `send_mail` tool accept an optional
  `draft` (`type` + `contextMessageId`, the same key as `save_draft`); once
  SMTP has accepted the mail the draft row is removed, so cleanup no longer
  depends on the client's own delete call succeeding. The web composer passes
  the key; a failed cleanup is logged and never turns a successful send into
  an error

## [v2026.08.16.3] - 2026-08-16

### Fixed

- Claude Code now loads Kurir's MCP tools after connecting. Every JSON-RPC
  result carries `resultType` (`complete` unless a tool asks for
  confirmation), which the 2026-07-28 revision requires, and `tools/list`
  uses `cacheScope: "private"` instead of the invalid `"server"`

## [v2026.08.16.2] - 2026-08-16

### Fixed

- Claude Code can now connect to `/mcp`. `server/discover` returns
  `supportedVersions` (and `serverInfo` in `_meta`) as the 2026-07-28
  DiscoverResult requires; without it clients treated Kurir as a legacy
  server, fell back to `initialize`, and got "Unsupported protocol version"
  (-32600)

## [v2026.08.16] - 2026-08-16

### Fixed

- Connecting Claude Code via `/mcp` no longer fails with "Invalid redirect".
  OAuth consent now accepts loopback redirect URIs (`http://localhost`,
  `http://127.0.0.1`) on any port, as required by RFC 8252 §7.3, since native
  clients bind an ephemeral port

## [v2026.08.15.2] - 2026-08-15

### Added

- Remote MCP server (spec 2026-07-28) at `POST /mcp` so Claude and other
  clients can use Kurir over HTTP
- Passkey OAuth consent for MCP connectors (CIMD, PKCE). Revoke under
  Settings → Connected apps
- MCP tools for mail (list, search, thread, archive, snooze, follow-up,
  reply-later), screener, contacts, drafts, scheduled send, files, and
  own-account settings
- Extra confirmation (MRTR) before send, reject, and other destructive
  actions

### Fixed

- Production TypeScript build no longer fails when creating an MCP
  attachment upload

## [v2026.08.15] - 2026-08-15

### Added

- Remote MCP server (spec 2026-07-28) at `POST /mcp` so Claude and other
  clients can use Kurir over HTTP
- Passkey OAuth consent for MCP connectors (CIMD, PKCE). Revoke under
  Settings → Connected apps
- MCP tools for mail (list, search, thread, archive, snooze, follow-up,
  reply-later), screener, contacts, drafts, scheduled send, files, and
  own-account settings
- Extra confirmation (MRTR) before send, reject, and other destructive
  actions

## [v2026.08.14.2] - 2026-08-14

### Fixed

- Closed a hole where any signed-in user could read or create contacts under another account
- Rejected mail no longer disappears from the app if the IMAP archive move fails
- Undo after screening out a sender now brings the mail back from the archive
- Compose no longer sends twice on a double-click
- Sending a scheduled message now (or undoing it) no longer loses the copy if you refresh during the undo window
- Drafts keep Cc/Bcc and attachments, including files forwarded from IMAP
- Tracker images hidden in CSS comments are blocked
- The image proxy pins DNS so it no longer follows rebinding to internal addresses

## [v2026.08.14] - 2026-08-14

### Fixed

- Sign-in, register, and other auth pages scroll again when the content is
  taller than the viewport. The global mail-UI overscroll fix locks document
  scrolling, which left anything below the fold unreachable on these pages —
  most visibly the demo credentials form inside the iOS app's narrow sign-in
  sheet.
- Demo instances now show the demo credentials form first on the sign-in
  page, above the passkey button, so it is visible without scrolling.

## [v2026.08.13] - 2026-08-13

### Changed

- Drafts catalog: every row has a labeled Delete button and asks before removing the draft
- Drafts rows use the same hierarchy as the mail lists: Reply / Forward / New, a To: line, and relative timestamps

### Added

- Mouse back (and Esc) closes the open mail and returns to the previous conversation, or the list if that was the first one

## [v2026.08.11] - 2026-08-11

### Added

- Drafts catalog: every draft - new mail, replies, forwards - in one browsable list, at `/drafts` on the web, in the iOS More tab, and in the macOS sidebar (with live count) between Scheduled and Sent
- Multiple parallel new-mail drafts: each compose autosaves under its own client-generated draft key instead of overwriting a single shared slot

### Fixed

- Reopening a draft restores its attachments instead of silently dropping them on the next autosave

## [v2026.08.09] - 2026-08-09

### Fixed

- Self-host: the generated Docker Compose file (and `docker-compose.production.yml`) now passes `PUSH_RELAY_URL` to the app container, defaulting to the hosted APNs relay - iOS push notifications previously never worked on self-hosted installs. Set `PUSH_RELAY_URL=` (empty) in `.env` to opt out. Existing installations need to add the line to their compose file or re-run the installer; image updates alone do not change the compose file
- Push: when neither APNs keys nor `PUSH_RELAY_URL` are configured, iOS subscriptions are now skipped with a clear `iOS push not configured` warning instead of attempting a relay send against an undefined URL and logging `relay unreachable` on every push

## [v2026.08.06.3] - 2026-08-06

### Added

- Mobile: the sync payload now carries the user's remote-image policy (`imagePolicy`: block all / block trackers / allow all), so the iOS/macOS app mirrors the web privacy behavior — including the "load images, block trackers" middle ground with its trackers-blocked badge

## [v2026.08.06.2] - 2026-08-06

### Added

- Screen domains retroactively (plan 034): a "Screen domain" action in the thread header and on screened-list rows creates a domain rule from an existing sender. The origin sender always follows the rule (matching pending senders are swept as before); other already-decided senders are never touched
- Mobile: the `createDomainRule` action now moves the origin sender with the rule, so the iOS/macOS "Screen domain" menus work from the thread view, message list and screened list

## [v2026.08.06] - 2026-08-06

### Added

- Domain screening rules (plan 033): a scope selector in the screener lets a decision apply to just the sender, the whole domain, or a subdomain wildcard (`*.github.com`). Rules approve into a category or screen out, apply automatically to new senders at sync (own addresses always win), and retroactively sweep matching pending senders when created. Rules appear at the top of the screened list with the same category/remove affordances as sender rows
- Mobile API: `createDomainRule`, `changeDomainRuleCategory` and `deleteDomainRule` actions, plus a `domainRules` field in the sync payload (replace-all) for the iOS/macOS app

## [v2026.08.05.1] - 2026-08-05

### Fixed

- Settings: connection-card actions (catch-all toggle, aliases, send-as, set-default, delete) no longer lock up permanently when a request fails or stalls. Requests now time out (30s; 5 min for sync), server errors surface as an inline message on the card, and a failed action re-enables the controls instead of replacing the settings page with the error boundary
- Admin: the Updates changelog had not been updated since April — backfilled all releases from v2026.04.21 through v2026.08.05, and updating it is now a required step of the release process

## [v2026.08.05] - 2026-08-05

### Added

- Catch-all domains: a per-connection "Treat every address on this domain as mine" setting (`treatDomainAsOwn`) makes every address on the connection's domain count as the user's own — in Screener exclusion, sync-time auto-approve, All Mail classification, follow-up detection, and the mobile sync payload
- Settings: catch-all toggle on the connection card next to alias management
- Setup wizard (password flow) now collects aliases and the catch-all setting, so they apply from the very first sync

### Fixed

- Stale `PENDING` "ghost" sender rows for the user's own addresses (created before an alias was configured) are now swept to approved/Imbox — hourly, and immediately when aliases, send-as, or the catch-all setting change. Together with the iOS app persisting connections locally, this removes the old alias mail that flashed in the Screener at cold start

## [v2026.08.04] - 2026-08-04

### Fixed

- Fresh self-host installs never got a database schema: the container entrypoint now bootstraps an empty database with `prisma db push` plus all ad-hoc SQL migrations, while non-empty databases (e.g. the shared production instance) are still never pushed
- The `search_vector` full-text-search migration silently failed on every boot — Prisma 7 removed `db execute --schema`; the flag is dropped and real failures are now visible in the logs
- Container healthcheck used `localhost`, which BusyBox wget resolves to `::1` while Next.js binds IPv4 only, so the app could never report healthy; now probes `127.0.0.1`
- `install.sh` reported "All services are running" for an unhealthy app (`grep -q "healthy"` also matches "unhealthy"); the wait loop now requires an exact health-state match
- Redis eviction policy changed from `allkeys-lru` to `noeviction` — BullMQ requires it, and eviction could silently drop queued jobs
- Rolling-release distros without `VERSION_ID` (e.g. Arch) were reported as "arch 0" by the installer

## [v2026.07.24] - 2026-07-24

### Added

- Mobile API for the native iOS client: sync, search, actions, compose/send with dual session/bearer auth, and APNs push registration (M1–M6).
- Mobile full-text search endpoint backed by the same FTS index as the web.
- Sync and search payloads now carry a flat `folderRole` so the iOS app can show a Sent list.
- The message body endpoint returns attachment metadata (`id`, `filename`, `contentType`, `size`) so clients can list and open attachments.

### Changed

- Sharpened editorial redesign across the web client; screener uses category icons instead of dots.

### Fixed

- View switching in the mobile PWA feels instant.

## [v2026.06.22] - 2026-06-22

### Fixed

- Eliminated a UI freeze in the PWA when navigating between views and performing actions, making the interface noticeably snappier.

## [v2026.06.11] - 2026-06-11

### Changed

- Marking a thread Reply Later now removes it from the Imbox, Feed, and Paper Trail lists (and their unread badge counts) until the flag is cleared, mirroring how snoozed messages behave. Deferred threads no longer linger in the lists they were deferred from.

## [v2026.06.10.2] - 2026-06-10

### Added

- A third remote-image privacy mode: **Load images, block trackers**. In addition to "Block all remote images" (the default) and "Load all remote images", you can now load ordinary content images while still stripping known email trackers and invisible spy pixels (1×1 / 0px / `display:none` images). Detection runs before any network request fires, so blocked trackers never load. A new Privacy section in Settings → Mail lets you choose the mode, and tracked threads show a compact "N trackers blocked" indicator. Per-sender trust and the one-time "Load images" action continue to load everything.
  - **Self-hosting note:** this adds a `blockTrackers` column to the `User` table (default `true`). Because the production database shares its instance with another app, apply it as explicit SQL rather than `prisma db push` — the statement is in `prisma/migrations/tracker_blocker.sql` (idempotent `ADD COLUMN IF NOT EXISTS`). **Run it before deploying the new app image**, since the thread and settings pages `SELECT` the column and will error if it is missing: `bin/deploy app exec --reuse "psql \"$DATABASE_URL\" -f -" < prisma/migrations/tracker_blocker.sql`.

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
