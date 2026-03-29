# Kurir

A self-hosted email client inspired by [HEY](https://www.hey.com). Kurir connects to your existing email via IMAP/SMTP and gives you a calmer, more focused experience. Open source under the [O'Saasy License](LICENSE).

**[Website](https://cfarvidson.github.io/kurir-server/)** · **[Documentation](https://cfarvidson.github.io/kurir-server/docs/getting-started)** · **[GitHub Sponsors](https://github.com/sponsors/cfarvidson)**

## Features

- **Screener** — New senders land here, not your inbox. You decide who gets through.
- **Imbox** — Only mail from approved senders. The important stuff.
- **The Feed** — Newsletters and subscriptions in a browsable feed.
- **Paper Trail** — Receipts and notifications, kept separate.
- **Full-text search** — PostgreSQL-powered search across every email.
- **Snooze & follow-ups** — Snooze messages until later. Set follow-up reminders.
- **Scheduled send** — Write now, send later.
- **Threaded conversations** — Messages grouped by thread, reply inline.
- **Compose in Markdown** — Rich email authoring with auto-save drafts.
- **Keyboard-first** — Full shortcuts, command palette, vim-style navigation.
- **Mobile PWA** — Install on iOS and Android with push notifications.
- **Dark mode** — Light, dark, or match your system.
- **Multi-account** — Connect multiple email accounts, send from any.
- **Archive** — Archive with undo, swipe gestures on mobile.
- **Contacts** — Browse all senders, view conversation history.
- **Admin dashboard** — System health, sync status, user management.
- **One-command install** — Single `curl` command provisions a fresh server.
- **Auto-updates** — Checks for new versions, one-click update from admin.
- **Backup & restore** — Full database + config backup and restore.

## Quick Start

### One-Command Install (Recommended)

Provisions a fresh Ubuntu 22.04+ or Debian 12+ server with everything:

```bash
curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
```

The installer handles Docker, PostgreSQL, Redis, HTTPS (via Caddy + Let's Encrypt), and all secrets. Once running, open your domain to complete the setup wizard.

### Setup Wizard

On first visit, Kurir walks you through:

1. **Create account** — Set your name and register a passkey (WebAuthn)
2. **Connect email** — Enter your IMAP/SMTP credentials (or use OAuth for Gmail/Outlook)
3. **Initial sync** — Kurir fetches your emails with a live progress indicator
4. **Done** — You land in your Imbox

### Local Development

```bash
pnpm install
docker compose up postgres -d
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm dev
```

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Auth:** NextAuth.js v5 (passkeys via WebAuthn, OAuth for Gmail/Outlook)
- **Database:** PostgreSQL 16 + Prisma 6
- **Email:** ImapFlow (IMAP), Nodemailer (SMTP)
- **Search:** PostgreSQL full-text search (tsvector + GIN index)
- **Cache:** Redis 7 (SSE push, sync jobs)
- **UI:** Tailwind CSS, shadcn/ui, Framer Motion
- **State:** TanStack Query, Zustand
- **PWA:** Service worker with Web Push notifications

## Email Providers

Kurir works with any IMAP/SMTP provider:

| Provider | IMAP Host             | SMTP Host           | Auth                                                                       |
| -------- | --------------------- | ------------------- | -------------------------------------------------------------------------- |
| Gmail    | imap.gmail.com        | smtp.gmail.com      | OAuth or [App Password](https://support.google.com/accounts/answer/185833) |
| Outlook  | outlook.office365.com | smtp.office365.com  | OAuth or App Password                                                      |
| iCloud   | imap.mail.me.com      | smtp.mail.me.com    | [App Password](https://support.apple.com/en-us/102654)                     |
| Fastmail | imap.fastmail.com     | smtp.fastmail.com   | App Password                                                               |
| Yahoo    | imap.mail.yahoo.com   | smtp.mail.yahoo.com | App Password                                                               |

For other providers, use the custom option and enter your server details.

## Deployment Options

### Option A: One-Command Installer

```bash
curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
```

Handles everything: Docker, secrets, HTTPS, database. Idempotent — safe to re-run.

### Option B: Docker Compose

```bash
cp .env.production.example .env
# Edit .env — set DOMAIN, generate secrets
docker compose -f docker-compose.production.yml up -d
```

### Option C: Kamal

For multi-host deploys across Tailscale-connected servers. See [DEPLOY.md](DEPLOY.md).

```bash
kamal setup    # First deploy
kamal deploy   # Subsequent deploys
```

## Scripts

```bash
pnpm dev          # Dev server (Turbopack, port 3000)
pnpm build        # Production build
pnpm lint         # ESLint
pnpm db:push      # Push Prisma schema to DB
pnpm db:generate  # Regenerate Prisma client
pnpm db:studio    # Prisma Studio GUI
pnpm add-user     # CLI: add user with IMAP/SMTP config
pnpm sync-user    # CLI: trigger sync for user(s)
pnpm backup       # Create backup archive (pg + redis + env)
pnpm restore      # Restore from backup archive
```

## License

[O'Saasy License](LICENSE) — open source with one restriction: you cannot take this code and offer it as a competing hosted email service. Self-hosting for personal or business use is fully permitted.
