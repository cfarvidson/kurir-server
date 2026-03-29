# Kurir

A Hey.com-inspired email client built with Next.js 15. Kurir connects to your existing email provider via IMAP/SMTP and gives you a calmer, more focused email experience.

## Features

### Screener

First-time senders land in the Screener, not your inbox. You decide who gets through:

- **Screen In** - Approve the sender, their emails go to your Imbox
- **Screen Out** - Reject silently, you'll never hear from them again

### Imbox

Your curated inbox showing only emails from approved senders:

- **New For You** - Unread messages at the top
- **Previously Seen** - Read messages below

### The Feed

Newsletters and subscriptions in a browsable feed format.

### Paper Trail

Receipts, shipping notifications, and transactional emails kept separate.

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js v5
- **Email**: ImapFlow (IMAP), Nodemailer (SMTP), MailParser
- **UI**: Tailwind CSS, shadcn/ui components, Framer Motion
- **State**: TanStack Query, Zustand

## Quick Start

### With Docker (Recommended)

```bash
# Clone and enter directory
cd kurir-server

# Copy environment file
cp .env.example .env

# Start PostgreSQL and the app
docker compose up -d

# Run database migrations
docker compose exec app pnpm prisma migrate dev

# Open in browser
open http://localhost:3000
```

### Local Development

```bash
# Install dependencies
pnpm install

# Start PostgreSQL (or use your own)
docker compose up postgres -d

# Copy and configure environment
cp .env.example .env
# Edit .env with your database URL

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Start dev server
pnpm dev
```

## Environment Variables

```bash
# Database
DATABASE_URL="postgresql://kurir:kurir@localhost:5432/kurir"

# NextAuth (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"

# Email password encryption (generate with: openssl rand -base64 32)
ENCRYPTION_KEY="your-encryption-key"

# OAuth (optional — enables "Sign in with" buttons for Gmail/Outlook)
MICROSOFT_CLIENT_ID="your-azure-app-client-id"
MICROSOFT_CLIENT_SECRET="your-azure-app-client-secret"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
```

## Connecting Your Email

Kurir supports any email provider with IMAP/SMTP access:

| Provider | IMAP Host             | SMTP Host           | Notes                                                                      |
| -------- | --------------------- | ------------------- | -------------------------------------------------------------------------- |
| Gmail    | imap.gmail.com        | smtp.gmail.com      | OAuth or [App Password](https://support.google.com/accounts/answer/185833) |
| Outlook  | outlook.office365.com | smtp.office365.com  | OAuth (recommended) or App Password                                        |
| iCloud   | imap.mail.me.com      | smtp.mail.me.com    | Requires [App Password](https://support.apple.com/en-us/102654)            |
| Yahoo    | imap.mail.yahoo.com   | smtp.mail.yahoo.com | Requires App Password                                                      |

For other providers, use the "Custom" option and enter your IMAP/SMTP settings.

### OAuth Setup (Microsoft / Google)

OAuth lets users connect Gmail and Outlook accounts without app passwords. It's optional — password-based connections still work. OAuth buttons only appear in the UI when the corresponding env vars are set.

#### Microsoft (Azure AD / Entra)

Requires a free Azure account which creates an Entra ID tenant. App registration is free forever — the credit card is for identity verification only.

1. Create a free Azure account at https://azure.microsoft.com/free
2. Go to [entra.microsoft.com](https://entra.microsoft.com) > Identity > Applications > App registrations > New registration
3. Name: e.g. "Kurir Mail"
4. Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"** (multi-tenant + personal)
5. Redirect URI (Web): `https://<your-domain>/api/auth/oauth/callback`
6. Click Register, copy the **Application (client) ID** → `MICROSOFT_CLIENT_ID`
7. Go to Certificates & secrets > New client secret, copy the value → `MICROSOFT_CLIENT_SECRET`
8. Go to API permissions > Add a permission > APIs my organization uses > search **"Office 365 Exchange Online"**

   > **Not showing up?** Free tenants don't have the Exchange service principal pre-provisioned. Go to your app's **Manifest** tab, find the `requiredResourceAccess` array, and add:
   >
   > ```json
   > {
   >   "resourceAppId": "00000002-0000-0ff1-ce00-000000000000",
   >   "resourceAccess": [
   >     { "id": "5df07973-7d5d-46ed-f847-aeb6baeafa96", "type": "Scope" },
   >     { "id": "258f6531-6087-4cc4-bb90-092c5fb3ed3f", "type": "Scope" }
   >   ]
   > }
   > ```
   >
   > Save the manifest, then continue to step 10.

9. Select **Delegated permissions**, add:
   - `IMAP.AccessAsUser.All`
   - `SMTP.Send`
10. Click "Grant admin consent" (you are tenant admin on a free account)

#### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com) > APIs & Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://<your-domain>/api/auth/oauth/callback`
4. Enable the **Gmail API** in the API Library
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

Both providers use `NEXTAUTH_URL` as the base for the redirect URI. Token refresh is handled automatically.

## Production Deployment

Three deployment options are available:

### Option A: One-Command Installer (Recommended)

Provisions a fresh Ubuntu 22.04+ or Debian 12+ server with a single command. Handles secrets, HTTPS, and everything.

```bash
curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
```

The installer will:

- Verify prerequisites (Docker, ports 80/443)
- Generate all secrets (auth, encryption, database, VAPID keys)
- Prompt for your domain name and email (for Let's Encrypt)
- Write configuration to `/opt/kurir/`
- Pull images and start all services
- Set up automatic HTTPS via Caddy + Let's Encrypt

Once running, open `https://your-domain.com` to complete the first-run setup wizard.

The script is idempotent — re-running it preserves existing secrets and lets you update the domain/email.

**Manage your installation:**

```bash
cd /opt/kurir
docker compose logs -f              # Tail logs
docker compose pull && docker compose up -d  # Update to latest
docker compose restart app           # Restart the app
```

### Option B: Docker Compose (Manual)

All-in-one single-server deployment with automatic HTTPS. Same stack as the installer, configured manually.

```bash
# Configure
cp .env.production.example .env
# Edit .env — set DOMAIN, generate secrets with: openssl rand -base64 32

# Deploy
docker compose -f docker-compose.production.yml up -d
```

This starts Caddy (reverse proxy with auto Let's Encrypt), the Next.js app, PostgreSQL, and Redis. Database migrations run automatically on startup. See `.env.production.example` for all configuration options.

### Option C: Kamal (Multi-Host)

For deploying across multiple Tailscale-connected servers with a private Docker registry. See [DEPLOY.md](DEPLOY.md) for the full guide.

```bash
kamal setup    # First deploy
kamal deploy   # Subsequent deploys
```

## Project Structure

```
kurir-server/
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── app/
│   │   ├── (auth)/         # Login page
│   │   ├── (mail)/         # Main mail UI
│   │   │   ├── imbox/
│   │   │   ├── screener/
│   │   │   ├── feed/
│   │   │   ├── paper-trail/
│   │   │   ├── compose/
│   │   │   └── settings/
│   │   └── api/            # API routes
│   ├── components/
│   │   ├── ui/             # Base UI components
│   │   ├── layout/         # Sidebar, headers
│   │   ├── mail/           # Message list, viewer
│   │   └── screener/       # Screener cards
│   ├── lib/
│   │   ├── auth.ts         # NextAuth config
│   │   ├── db.ts           # Prisma client
│   │   ├── crypto.ts       # Password encryption
│   │   └── mail/           # IMAP/SMTP services
│   ├── actions/            # Server actions
│   └── types/              # TypeScript types
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm db:generate  # Generate Prisma client
pnpm db:migrate   # Run database migrations
pnpm db:push      # Push schema changes (dev only)
pnpm db:studio    # Open Prisma Studio
pnpm add-user     # Add a user via CLI
pnpm list-users   # List all users
pnpm sync-user    # Sync emails for a user
```

## User Management

Kurir supports multiple users, each with their own email account and screened senders.

### Adding Users via CLI

```bash
# Interactive mode
pnpm add-user

# With arguments (for scripting)
pnpm add-user --email user@gmail.com --password "app-password" --provider gmail

# Custom IMAP/SMTP servers
pnpm add-user --email user@example.com --password "pass" \
  --imap-host imap.example.com --smtp-host smtp.example.com
```

### Listing Users

```bash
pnpm list-users
```

### Syncing Emails

```bash
# Sync a specific user
pnpm sync-user user@gmail.com

# Sync all users
pnpm sync-user --all
```

## How It Works

1. **Connect** - Enter your email credentials (stored encrypted)
2. **Sync** - Kurir fetches your emails via IMAP
3. **Screen** - New senders appear in the Screener for your decision
4. **Read** - Approved emails appear in your Imbox, categorized automatically

### Sender Classification

When you screen in a sender, choose where their emails go:

- **Imbox** - Important messages from people
- **The Feed** - Newsletters you want to read
- **Paper Trail** - Receipts and transactional emails

## Security

- Email passwords are encrypted with AES-256-GCM before storage
- All connections to email servers use TLS
- Sessions use HTTP-only cookies with JWT
- Credentials are never exposed to the client

## License

[O'Saasy License](LICENSE) — open source, but no competing SaaS. You can use, modify, and self-host freely. You cannot take this code and offer it as a hosted email service.
