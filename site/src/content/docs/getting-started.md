---
title: Getting Started
description: Learn what Kurir is, what you need to run it, and how to get up and running in minutes.
order: 1
---

# Getting Started

Kurir is a self-hosted email client inspired by [Hey.com](https://hey.com). It connects to your existing email provider via IMAP and SMTP, giving you a calmer, more focused email experience -- without handing your data to a third party.

## How it works

1. **Connect** -- Enter your email credentials (stored encrypted with AES-256-GCM on your server).
2. **Sync** -- Kurir fetches your emails via IMAP using a batched UID delta strategy.
3. **Screen** -- New senders land in the Screener. You decide who gets through.
4. **Read** -- Approved emails appear in your Imbox, Feed, or Paper Trail, categorized the way you choose.

### The four views

- **Screener** -- First-time senders wait here for your approval or rejection.
- **Imbox** -- Your curated inbox. Only emails from approved senders, split into "New For You" and "Previously Seen."
- **The Feed** -- Newsletters and subscriptions in a browsable feed format.
- **Paper Trail** -- Receipts, shipping notifications, and transactional emails kept separate.

## Prerequisites

Before installing Kurir, make sure you have:

- A Linux server (Ubuntu 22.04+ or Debian 12+ recommended) or any machine that runs Docker
- **Docker 20+** with the Compose plugin
- Ports **80** and **443** open (for HTTPS via Let's Encrypt)
- A **domain name** pointed at your server (e.g. `mail.example.com`)
- An email account with IMAP/SMTP access (Gmail, Outlook, iCloud, Yahoo, or any custom provider)

## Quick start

Kurir offers three deployment options depending on your setup:

### Option A: One-command installer (recommended)

A single `curl` command that provisions everything on a fresh server -- secrets, HTTPS, database, and all services.

```bash
curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
```

### Option B: Docker Compose (manual)

Same stack as the installer, but you configure the environment file yourself.

```bash
cp .env.production.example .env
# Edit .env with your domain and generated secrets
docker compose -f docker-compose.production.yml up -d
```

### Option C: Kamal (multi-host)

For deploying across multiple Tailscale-connected servers with a private Docker registry.

```bash
kamal setup    # First deploy
kamal deploy   # Subsequent deploys
```

Each option is covered in detail in the [Installation guide](installation).

## What's next

- [Installation](installation) -- Detailed walkthrough of each deployment option
- [Configuration](configuration) -- All environment variables explained
- [Email Accounts](email-accounts) -- Connect Gmail, Outlook, iCloud, or any IMAP provider
