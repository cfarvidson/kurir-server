---
title: FAQ
description: Frequently asked questions about Kurir, including licensing, privacy, provider support, and more.
order: 9
---

# Frequently Asked Questions

## Is Kurir free?

Yes. Kurir is open source and released under the [O'Saasy license](https://github.com/cfarvidson/kurir-server/blob/main/LICENSE). You can use it, modify it, and self-host it at no cost. The only expense is your own server.

## Which email providers are supported?

Any provider that supports IMAP and SMTP. This includes Gmail, Outlook / Microsoft 365, iCloud, Yahoo, Fastmail, Proton Mail (with the Bridge app), and any custom mail server. See [Email Accounts](email-accounts) for the full list with connection details.

## Can multiple people use one installation?

Yes. Kurir is multi-user. Each user has their own email account, their own Screener decisions, and their own categorized views (Imbox, Feed, Paper Trail). All data is isolated per user via `userId` filters in every database query.

Add users via the CLI:

```bash
pnpm add-user
```

Or through the web UI in Settings.

## Where does my email data live?

All email data is stored in your PostgreSQL database on your server. Kurir does not send your emails or metadata to any third-party service. Your credentials are encrypted with AES-256-GCM before storage using the `ENCRYPTION_KEY` you set during installation.

## Does Kurir delete emails from my provider?

No. Kurir is read-only when it comes to your email provider. It syncs emails via IMAP but does not delete, move, or modify messages on the server. Your emails remain safely with your provider regardless of what you do in Kurir.

The only write operations are sending emails (via SMTP) and IMAP flag changes (marking messages as read).

## Can I use Kurir on my phone?

Yes. Kurir is a web application that works in any modern browser on any device. It supports Progressive Web App (PWA) installation, so you can add it to your home screen for an app-like experience with push notifications. See the [Mobile App](mobile-app) docs for step-by-step install instructions for iOS and Android.

## How is Kurir different from other email clients?

Kurir takes a different approach to email -- the Screener, the Imbox, the Feed, and the Paper Trail. The key differences:

- **Self-hosted**: You run it on your own server. No subscription required.
- **Open source**: O'Saasy license. You can read, modify, and contribute to the code.
- **Your data**: Emails live in your database, not on someone else's servers.
- **Your provider**: Kurir connects to your existing email account. You keep your email address and provider.
- **Free**: No monthly fee. Just the cost of a server (a $5-10/month VPS is plenty).

## What happens if I stop using Kurir?

Nothing. Your emails stay with your email provider exactly as they were. Kurir does not move or delete emails from your provider's servers. You can stop running Kurir at any time and continue using your email account with any other client.

Your Kurir-specific data (Screener decisions, categories, read state) lives in your PostgreSQL database. You can back it up, export it, or simply shut down the server.

## What tech stack does Kurir use?

- **Framework**: Next.js 15 with App Router and TypeScript
- **Database**: PostgreSQL 16 with Prisma ORM
- **Auth**: NextAuth.js v5 (supports credentials + passkeys + OAuth)
- **Email**: ImapFlow (IMAP), Nodemailer (SMTP), MailParser
- **UI**: Tailwind CSS, shadcn/ui components, Framer Motion
- **State**: TanStack Query, Zustand
- **Deployment**: Docker, Caddy (reverse proxy), Redis (queues/cache)

## What are the server requirements?

Kurir runs comfortably on a small VPS:

- **CPU**: 1 core minimum, 2 recommended
- **RAM**: 1 GB minimum, 2 GB recommended (the Docker Compose setup can use ~2 GB across all containers)
- **Disk**: 10 GB minimum, more depending on email volume
- **OS**: Ubuntu 22.04+ or Debian 12+ (other Linux distributions work but are untested)
- **Docker**: 20+ with the Compose plugin

## Can I contribute?

Yes. Kurir is open source on [GitHub](https://github.com/cfarvidson/kurir-server). Issues, bug reports, and pull requests are welcome.
