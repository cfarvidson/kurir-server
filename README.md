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
```

## Connecting Your Email

Kurir supports any email provider with IMAP/SMTP access:

| Provider | IMAP Host | SMTP Host | Notes |
|----------|-----------|-----------|-------|
| Gmail | imap.gmail.com | smtp.gmail.com | Requires [App Password](https://support.google.com/accounts/answer/185833) |
| Outlook | outlook.office365.com | smtp.office365.com | Requires App Password |
| iCloud | imap.mail.me.com | smtp.mail.me.com | Requires App Password |
| Yahoo | imap.mail.yahoo.com | smtp.mail.yahoo.com | Requires App Password |

For other providers, use the "Custom" option and enter your IMAP/SMTP settings.

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

MIT
