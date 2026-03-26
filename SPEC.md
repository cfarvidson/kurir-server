# Kurir — Application Specification

A Hey.com-inspired email client. Connects to any email provider via IMAP/SMTP and gives users control over who can reach their inbox through sender-based categorization.

## Core Concept

The central idea, borrowed from Hey.com: **new senders don't automatically land in your inbox.** Instead, they go to the Screener. The user explicitly approves or rejects each sender, and approved senders are categorized into one of three buckets:

- **Imbox** — Important mail (people you correspond with)
- **Feed** — Newsletters and subscriptions (read at your leisure)
- **Paper Trail** — Transactional mail (receipts, shipping notifications, confirmations)

Rejected senders are silently ignored forever.

---

## Tech Stack

| Layer             | Technology                                               |
| ----------------- | -------------------------------------------------------- |
| Framework         | Next.js 15 (App Router, Turbopack)                       |
| Language          | TypeScript 5.7, strict mode                              |
| React             | React 19                                                 |
| Auth              | NextAuth.js v5 beta, WebAuthn/passkeys (SimpleWebAuthn)  |
| ORM               | Prisma 6                                                 |
| Database          | PostgreSQL 16                                            |
| IMAP              | ImapFlow 1.0.171                                         |
| SMTP              | Nodemailer                                               |
| Email parsing     | MailParser                                               |
| Styling           | Tailwind CSS (HSL variables), shadcn/ui components (CVA) |
| Icons             | lucide-react                                             |
| Data fetching     | TanStack React Query v5                                  |
| State             | Zustand v5                                               |
| Animation         | Framer Motion                                            |
| Validation        | Zod                                                      |
| HTML sanitization | DOMPurify                                                |
| Package manager   | pnpm 9.15.0                                              |
| Containerization  | Docker + Docker Compose                                  |

---

## Data Model

### User

Identity-only model. No email credentials — those live on EmailConnection.

```
User
  id            String    @id @default(cuid())
  displayName   String?
  timezone      String    @default("UTC")
  createdAt     DateTime
  updatedAt     DateTime
  → passkeys, emailConnections, messages, senders, folders, sessions
```

### Passkey (WebAuthn)

Stores passkey credentials for passwordless login.

```
Passkey
  id              String    @id @default(cuid())
  credentialId    String    @unique   // base64url
  publicKey       String              // base64url, COSE format
  counter         BigInt    @default(0)  // replay protection
  deviceType      String              // "singleDevice" | "multiDevice"
  backedUp        Boolean   @default(false)
  transports      String[]            // e.g. ["internal", "hybrid"]
  friendlyName    String?             // e.g. "MacBook Pro Touch ID"
  userId          String → User
```

### EmailConnection

Per-user email account. A user can have multiple (e.g., personal + work). Each connection has its own IMAP/SMTP credentials, its own senders, folders, messages, and sync state.

```
EmailConnection
  id                String    @id @default(cuid())
  email             String
  displayName       String?
  imapHost          String
  imapPort          Int       @default(993)
  smtpHost          String
  smtpPort          Int       @default(587)
  encryptedPassword String              // AES-256-GCM encrypted
  isDefault         Boolean   @default(false)
  userId            String → User
  → messages, senders, folders, syncState
  @@unique([userId, email])
```

### Sender

Represents an email sender (From address), scoped to an EmailConnection.

```
SenderStatus enum: PENDING | APPROVED | REJECTED
SenderCategory enum: IMBOX | FEED | PAPER_TRAIL

Sender
  id                  String    @id @default(cuid())
  email               String              // normalized
  displayName         String?
  domain              String              // extracted for domain-level rules
  status              SenderStatus        @default(PENDING)
  category            SenderCategory      @default(IMBOX)
  decidedAt           DateTime?           // when approved/rejected
  messageCount        Int       @default(0)
  userId              String → User
  emailConnectionId   String → EmailConnection
  → messages
  @@unique([emailConnectionId, email])
  @@index([userId, status])
  @@index([userId, category])
  @@index([domain])
```

### Folder

Cached IMAP mailbox metadata.

```
Folder
  id                  String    @id @default(cuid())
  name                String              // e.g. "INBOX"
  path                String              // IMAP path
  delimiter           String    @default("/")
  uidValidity         Int?
  highestModSeq       BigInt?
  lastSyncedAt        DateTime?
  isSelectable        Boolean   @default(true)
  hasChildren         Boolean   @default(false)
  specialUse          String?             // "inbox", "sent", "drafts", "trash", "junk", "archive"
  userId              String → User
  emailConnectionId   String → EmailConnection
  → messages
  @@unique([emailConnectionId, path])
```

### Message

Cached email with metadata, body content, and categorization flags.

```
Message
  id                  String    @id @default(cuid())
  uid                 Int                 // IMAP UID (negative = locally created)
  messageId           String?             // RFC 2822 Message-ID
  threadId            String?             // computed thread ID
  inReplyTo           String?             // In-Reply-To header
  references          String[]            // References header
  subject             String?
  fromAddress         String
  fromName            String?
  toAddresses         String[]
  ccAddresses         String[]
  bccAddresses        String[]
  replyTo             String?
  sentAt              DateTime?           // Date header
  receivedAt          DateTime            // IMAP INTERNALDATE
  textBody            String?
  htmlBody            String?
  snippet             String?             // ~150 char preview
  isRead              Boolean   @default(false)
  isFlagged           Boolean   @default(false)
  isDraft             Boolean   @default(false)
  isDeleted           Boolean   @default(false)
  isAnswered          Boolean   @default(false)
  size                Int?
  hasAttachments      Boolean   @default(false)
  isInImbox           Boolean   @default(false)
  isInScreener        Boolean   @default(true)
  isInFeed            Boolean   @default(false)
  isInPaperTrail      Boolean   @default(false)
  isArchived          Boolean   @default(false)
  isSnoozed           Boolean   @default(false)
  snoozedUntil        DateTime?
  folderId            String → Folder
  userId              String → User
  emailConnectionId   String → EmailConnection
  senderId            String? → Sender
  → attachments
  @@unique([folderId, uid])
```

Key indexes: by category + isRead, by threadId, by messageId, by senderId, by receivedAt desc.

### Attachment

Metadata for IMAP attachments. Content is lazy-fetched from IMAP on demand.

```
Attachment
  id          String    @id @default(cuid())
  filename    String
  contentType String              // MIME type
  size        Int                 // bytes
  contentId   String?             // CID for inline attachments
  partId      String              // IMAP part ref, e.g. "1.2"
  encoding    String?             // "base64", "quoted-printable"
  messageId   String → Message
```

### SyncState

Per-connection sync lock and status.

```
SyncState
  id                  String    @id @default(cuid())
  emailConnectionId   String    @unique → EmailConnection
  lastFullSync        DateTime?
  isSyncing           Boolean   @default(false)
  syncStartedAt       DateTime?
  syncError           String?
```

### Session

NextAuth JWT session storage.

```
Session
  id            String    @id @default(cuid())
  sessionToken  String    @unique
  userId        String → User
  expires       DateTime
```

### Full-Text Search (not in Prisma)

A `search_vector` tsvector column on Message, maintained by a PostgreSQL trigger. Not managed by Prisma — applied via a manual SQL migration (`prisma/migrations/search_vector.sql`).

- Weights: subject (A) > fromName (B) > body text (C)
- GIN index for fast lookups
- Trigger fires on INSERT/UPDATE of subject, textBody, htmlBody, fromName
- Backfill loop for existing messages

---

## Authentication

### Architecture Split

The auth system is split into two files to accommodate Next.js edge runtime constraints:

- **auth.config.ts** — Edge-safe. Contains JWT callbacks, session strategy config, custom pages. Used by middleware. Cannot import anything that uses Node.js `crypto`.
- **auth.ts** — Full Node.js. Imports auth.config.ts and adds providers, DB adapter, etc.

### WebAuthn (Passkey) Authentication

No passwords. Users register and login exclusively with passkeys (Touch ID, Face ID, security keys, etc.).

**Registration flow:**

1. `POST /api/auth/webauthn/register/options` — Generate registration challenge, store server-side in a challenge session (httpOnly cookie, 5-min TTL)
2. Browser prompts user for biometric/security key
3. `POST /api/auth/webauthn/register/verify` — Verify credential, create User + Passkey records, issue JWT session cookie
4. Supports adding additional passkeys to existing user (`?addPasskey=true` param, requires existing session)

**Login flow:**

1. `POST /api/auth/webauthn/login/options` — Generate authentication challenge
2. Browser prompts user for biometric/security key (supports conditional mediation / autofill)
3. `POST /api/auth/webauthn/login/verify` — Verify credential + counter, update counter, issue JWT session cookie

**Session management:**

- JWT-based sessions stored in httpOnly cookies
- 30-day expiration
- Challenge sessions: 5-min TTL, single-use

### Encryption

Email passwords are encrypted at rest using AES-256-GCM:

- Key derived from `ENCRYPTION_KEY` env var via `scryptSync`
- Format: `iv:authTag:encryptedData` (all base64)
- Applied to `EmailConnection.encryptedPassword`

### Middleware

Route protection via Next.js middleware:

- Auth API routes (`/api/auth/*`) — always allowed
- Login/register/setup pages — allowed for unauthenticated users; logged-in users redirected to `/imbox`
- All other routes — require authentication, redirect to `/login` if not logged in
- Matcher excludes static assets (`_next/static`, `_next/image`, `favicon.ico`)

---

## IMAP Sync Engine

### Batch Sync (`sync-service.ts`)

Triggered by `POST /api/mail/sync` or CLI `pnpm sync-user`.

**Process:**

1. Acquire sync lock (atomic check: `isSyncing=false OR syncStartedAt > 5 min ago`)
2. Connect to IMAP server via ImapFlow
3. Discover/sync folders: INBOX, Sent, All-Mail (by specialUse flags)
4. For each folder:
   a. Fetch all UIDs from server
   b. Compare with cached UIDs → identify new messages
   c. Batch-fetch new messages (configurable `batchSize`)
   d. Parse each message with MailParser
   e. Detect/create Sender (auto-approve if sender email matches user's own email)
   f. Set categorization flags based on sender status and folder type
   g. Extract attachment metadata (content NOT fetched — lazy-loaded later)
   h. Create Message + Attachment records
5. Run `repairThreadIds()` — walks In-Reply-To/References chains to unify threadIds across conversations
6. Wake snoozed conversations whose `snoozedUntil` has passed
7. Release sync lock

**Message processing rules:**

- Inbox messages from PENDING sender → `isInScreener = true`
- Inbox messages from APPROVED sender → set category flag (`isInImbox`, `isInFeed`, or `isInPaperTrail`)
- Inbox messages from REJECTED sender → all category flags false (hidden)
- Sent folder messages → no category flags (not screened)
- All-Mail messages → skip if already synced from another folder (dedup by messageId)

**Thread ID computation:**

- Initial: first entry in References header, or In-Reply-To, or own Message-ID
- Repair pass: `repairThreadIds()` walks chains to ensure all messages in a conversation share the same threadId

### IDLE Daemon (Real-time Push)

Persistent IMAP connections that listen for server-side changes.

**Connection Manager (`connection-manager.ts`):**

- GlobalThis singleton (survives Next.js HMR in dev)
- One long-lived IMAP connection per EmailConnection
- QRESYNC enabled for modseq tracking
- Exponential backoff reconnection: 0s, 5s, 15s, 30s, 60s, 5m
- Graceful shutdown on SIGTERM

**IDLE Event Handlers (`idle-handlers.ts`):**

| Event     | Trigger                              | Action                                     |
| --------- | ------------------------------------ | ------------------------------------------ |
| `exists`  | New message count increased          | Fetch new UIDs, process messages, emit SSE |
| `flags`   | Read/unread/flagged change on server | Update DB flags, emit SSE                  |
| `expunge` | Message deleted on server            | Mark as deleted in DB                      |

**Debouncing:** Rapid `exists` events debounced (200ms wait).

**Echo suppression:** When the app pushes a flag change to IMAP (e.g., marking as read), the resulting IDLE event is suppressed via a 10-second in-memory set keyed by `userId:folderId:uid`.

### Flag Push (`flag-push.ts`)

Bidirectional sync of read/unread/flagged status:

- Tries persistent IDLE client first (via ConnectionManager)
- Falls back to ephemeral IMAP connection
- Pushes `\Seen`, `\Flagged` flags
- Uses echo suppression to prevent loopback

### SSE (Server-Sent Events)

`GET /api/mail/events` — Real-time event stream.

Events:

- `new-messages` — New messages arrived (from IDLE)
- `flags-changed` — Flag update on existing message
- `message-deleted` — Message removed

Implementation: In-memory subscriber map (`userId → Set<callbacks>`). Single-process constraint — must run in the same Node.js process as ConnectionManager.

---

## Categorization System

### Sender Lifecycle

```
New email arrives from unknown sender
  → Sender created with status=PENDING
  → Message gets isInScreener=true
  → Appears in Screener page

User approves sender (picks category):
  → Sender status=APPROVED, category=IMBOX|FEED|PAPER_TRAIL
  → All non-archived messages move to chosen category
  → Future messages auto-categorized

User rejects sender:
  → Sender status=REJECTED
  → All non-archived messages hidden (all flags false)
  → Future messages silently hidden
```

### Auto-behaviors

- **Own email auto-approve:** Messages from the user's own email address are auto-approved as IMBOX
- **Auto-reject on archive:** When archiving from Screener, if all of a PENDING sender's messages are now archived, the sender is auto-rejected (prevents re-appearance)
- **Snooze wake-up:** On each sync, check for snoozed conversations past their `snoozedUntil` — unsnooze and mark unread

### Category Change

When a sender's category changes, all their non-archived messages are moved to the new category in a single transaction.

---

## Server Actions

All server actions follow this pattern: auth check → ownership verification → DB mutation (often `$transaction`) → cache invalidation (`revalidateTag("sidebar-counts")` + `revalidatePath`).

### Sender Actions (`src/actions/senders.ts`)

- **`approveSender(senderId, category)`** — Set sender APPROVED + chosen category. Move all non-archived messages from Screener to the category.
- **`rejectSender(senderId)`** — Set sender REJECTED. Hide all non-archived messages (all category flags false).
- **`changeSenderCategory(senderId, category)`** — Requires sender already APPROVED. Move all non-archived messages to new category.

### Archive Actions (`src/actions/archive.ts`)

- **`archiveConversation(messageId)`** — Find all thread messages. Move INBOX messages to Archive folder on IMAP server. Set `isArchived=true`, clear all category flags. Auto-reject fully-archived PENDING senders.
- **`archiveConversations(messageIds)`** — Batch version. Groups by EmailConnection for IMAP operations.
- **`unarchiveConversation(messageId)`** — Move Archive messages back to INBOX on IMAP. Restore category flags based on sender's current category.

### Snooze Actions (`src/actions/snooze.ts`)

- **`snoozeConversation(messageId, until)`** — Set `isSnoozed=true`, `snoozedUntil=date`, `isRead=true` (user acknowledged, just deferred). Applies to all thread messages.
- **`snoozeConversations(messageIds, until)`** — Batch version.
- **`unsnoozeConversation(messageId)`** — Clear snooze, set `isRead=false` (resurfaces as unread).

### Reply Action (`src/actions/reply.ts`)

- **`replyToMessage(messageId, body, to?)`** — Send reply via SMTP using the connection that received the message. Builds proper `In-Reply-To` and `References` headers. Creates a local sent message record (negative UID) for immediate display. Marks original as answered.

### Sidebar Action (`src/actions/sidebar.ts`)

- **`refreshSidebarCounts()`** — Just calls `revalidateTag("sidebar-counts")`.

---

## API Routes

### Auth Routes

| Method   | Path                                  | Purpose                         |
| -------- | ------------------------------------- | ------------------------------- |
| \*       | `/api/auth/[...nextauth]`             | NextAuth.js handler             |
| POST     | `/api/auth/webauthn/register/options` | Generate registration challenge |
| POST     | `/api/auth/webauthn/register/verify`  | Verify & create passkey         |
| POST     | `/api/auth/webauthn/login/options`    | Generate login challenge        |
| POST     | `/api/auth/webauthn/login/verify`     | Verify & authenticate           |
| GET/POST | `/api/auth/webauthn/passkeys/[id]`    | List/manage passkeys            |

### Email Connection Routes

| Method | Path               | Purpose                                  |
| ------ | ------------------ | ---------------------------------------- |
| GET    | `/api/connections` | List user's email connections            |
| POST   | `/api/connections` | Add new connection (verifies IMAP first) |

### Message Routes

| Method | Path            | Purpose                                             |
| ------ | --------------- | --------------------------------------------------- |
| GET    | `/api/messages` | Fetch messages by category, cursor-based pagination |

Query params: `category` (imbox/feed/paper-trail/archive/snoozed), `cursor`, `limit`

### Mail Routes

| Method | Path               | Purpose                          |
| ------ | ------------------ | -------------------------------- |
| POST   | `/api/mail/sync`   | Trigger email sync               |
| POST   | `/api/mail/send`   | Send new email                   |
| GET    | `/api/mail/events` | SSE stream for real-time updates |

Sync query params: `connectionId` (specific or all), `batchSize`, `resync` (force full resync)

### Attachment Routes

| Method | Path                    | Purpose                                 |
| ------ | ----------------------- | --------------------------------------- |
| GET    | `/api/attachments/[id]` | Lazy-fetch attachment content from IMAP |

### Contact Routes

| Method | Path                   | Purpose                       |
| ------ | ---------------------- | ----------------------------- |
| GET    | `/api/contacts/search` | Search contacts by name/email |

---

## Pages & Routing

### Route Groups

- **(auth)** — Unprotected pages for login, register, initial setup
- **(mail)** — Protected pages requiring authentication

### Auth Pages

| Path        | Description                                                |
| ----------- | ---------------------------------------------------------- |
| `/login`    | WebAuthn login (supports autofill / conditional mediation) |
| `/register` | WebAuthn registration (create account with passkey)        |
| `/setup`    | Initial setup after registration                           |

### Mail Pages

| Path             | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `/`              | Redirects to `/imbox`                                                   |
| `/imbox`         | Main inbox — approved IMBOX senders                                     |
| `/feed`          | Newsletters — approved FEED senders                                     |
| `/paper-trail`   | Transactional — approved PAPER_TRAIL senders                            |
| `/screener`      | New/pending senders — approve or reject                                 |
| `/archive`       | Archived conversations                                                  |
| `/snoozed`       | Snoozed conversations (with wake-up time)                               |
| `/sent`          | Sent messages                                                           |
| `/contacts`      | Contact list                                                            |
| `/contacts/[id]` | Contact detail / thread history                                         |
| `/compose`       | Compose new message                                                     |
| `/settings`      | Email connections + passkey management                                  |
| `/imbox/[id]`    | Thread detail view (same for feed, paper-trail, archive, sent, snoozed) |

### Mail Layout (`(mail)/layout.tsx`)

Wraps all mail pages. Renders:

- Desktop Sidebar (always visible)
- Mobile Sidebar (collapsible)
- AutoSync component (triggers periodic sync)
- Starts IDLE daemon for all user's email connections
- Caches sidebar badge counts via `unstable_cache` with 30s revalidation + `"sidebar-counts"` tag

---

## UI Components

### Message Display

- **InfiniteMessageList** — Infinite scroll with cursor-based pagination via React Query. Each row shows: sender, subject, snippet, timestamp, unread indicator, attachment icon, thread count badge.
- **MessageList** — Static list for search results (no pagination).
- **ThreadPageContent** — Full thread view. Shows all messages in chronological order. Auto-marks unread messages as read on view. Includes reply composer at bottom.
- **EmailBodyFrame** — Sandboxed iframe for rendering HTML email bodies. Uses DOMPurify to sanitize HTML (removes scripts, forms, dangerous handlers, data: URIs). Forces `target="_blank"` on all links. Supports collapsing quoted text.

### Sort Order

Messages sorted by: unread first (isRead ASC), then newest first (receivedAt DESC), then by ID (DESC). Cursor encoding: `isRead_receivedAt_id`.

### Thread Collapsing

In list views, messages are collapsed to one row per thread via `collapseToThreads()`. The representative message is the latest in the thread. If any message in the thread is unread, the row shows as unread. Thread count badge shows total messages.

### Screener

- **ScreenerView** — Shows pending senders grouped. Each sender card shows: name, email, message count, latest message preview.
- **ScreenedSenderList** — List of pending senders with approve (pick category) / reject buttons.

### Actions

- **ArchiveButton** — Archive single conversation or batch selection.
- **SnoozeButton** — Popover with time picker (later today, tomorrow, next week, custom date). Snoozes entire thread.
- **ReplyComposer** — Text input + send button. Sends via `replyToMessage` server action.
- **SelectionActionBar** — Appears when messages are selected. Batch archive, batch snooze.

### Sidebar

- **Sidebar** — Desktop navigation. Shows all category links with unread count badges. Includes manual sync button.
- **MobileSidebar** — Collapsible version for mobile viewports.
- **SearchInput** — Full-text search. Navigates to search results within current category.

### Settings

- **ConnectionCard** — Display email connection details (email, host, port, default status).
- **PasskeysList** — List registered passkeys + add new passkey button.
- **PasskeyCard** — Individual passkey with friendly name and delete option.

### Contacts

- **ContactList** — List of known senders with search.
- **ContactThreadList** — All conversations with a specific contact.

---

## Search

PostgreSQL full-text search via `search_vector` tsvector column.

**Query building:** User input is converted to a prefix tsquery. `"some thing"` becomes `some:* & thing:*` (enables partial matching).

**Execution:** Raw SQL query via `$queryRaw` with `Prisma.sql` template literals. Results ranked by `ts_rank` (relevance) then `receivedAt` (recency).

**Category filtering:** Each page passes its own SQL fragment as category filter (e.g., `AND "isInImbox" = true`).

---

## Sent Messages

### Sending

Reply via `replyToMessage` server action → Nodemailer SMTP transport → creates local sent message.

### Local Sent Messages

Sent replies are immediately persisted with a negative UID (`generateTempUid()` → random negative integer). This allows them to appear in the UI before the next IMAP sync reconciles them with the real server-side UID.

### Reconciliation

On next IMAP sync of the Sent folder, the sync engine matches local messages (negative UID) to server messages by `messageId` header. The negative UID is updated to the real UID.

---

## Real-Time Updates

1. **IDLE daemon** listens for IMAP server push events
2. Event handlers process changes (new messages, flag changes, deletions)
3. Changes are written to DB
4. SSE event emitted to connected browser clients
5. React Query invalidates affected queries
6. UI updates automatically

---

## Environment Variables

```
DATABASE_URL          PostgreSQL connection string
NEXTAUTH_SECRET       JWT signing secret (openssl rand -base64 32)
NEXTAUTH_URL          App URL (http://localhost:3000 in dev)
ENCRYPTION_KEY        AES-256-GCM key for email passwords (openssl rand -base64 32)
WEBAUTHN_RP_NAME      WebAuthn relying party display name (default: "Kurir")
WEBAUTHN_RP_ID        WebAuthn relying party ID / domain (default: "localhost")
NODE_ENV              "development" or "production"
```

---

## CLI Scripts

| Command                     | Script                               | Purpose                                                                                                                                                                      |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm add-user`             | `scripts/add-user.ts`                | Create user + email connection. Verifies IMAP before saving. Supports provider presets (gmail, outlook, icloud, yahoo) or custom hosts. Interactive prompts if args missing. |
| `pnpm sync-user`            | `scripts/sync-user.ts`               | Trigger IMAP sync for a user (by email) or all users (`--all`). Limits to 100 new messages per run.                                                                          |
| `pnpm list-users`           | `scripts/list-users.ts`              | Display all users.                                                                                                                                                           |
| `pnpm migrate:passkey-auth` | `scripts/migrate-to-passkey-auth.ts` | Convert old credential-based sessions to passkey auth.                                                                                                                       |

---

## Docker Setup

### docker-compose.yml

Two services:

**app** (Next.js):

- Build target: `dev`
- Port: 3000
- Bind mount `.:/app` with anonymous volumes for `node_modules/` and `.next/`
- Depends on postgres health check

**postgres** (PostgreSQL 16 Alpine):

- User: kurir, Password: kurir, DB: kurir
- Port: 5432
- Persistent volume: `postgres_data`
- Health check: `pg_isready`

### Dockerfile

Multi-stage: base → deps → dev / builder → runner.

- Dev stage runs `pnpm dev` (Turbopack)
- Requires `corepack prepare pnpm@9.15.0 --activate`
- Requires `pnpm db:generate` after COPY

---

## Important Implementation Details

### ImapFlow Fetch Gotcha

`client.fetch("256,255", {uid: true})` with comma-separated UIDs returns an empty iterator. Always use range format `"minUid:*"` and filter by desired UID set in the processing loop.

### Prisma + search_vector Coexistence

Prisma ignores unknown columns. The `search_vector` column is added via raw SQL migration and coexists safely with `prisma db push`. However, `--force-reset` would drop it.

### Negative UID Convention

- Positive UID = synced from IMAP server
- Negative UID = locally created (sent replies, pending sync)
- On sync, negative UIDs are reconciled by matching `messageId` headers

### Thread Repair

After sync, `repairThreadIds()` walks In-Reply-To chains to ensure all messages in a conversation share the same threadId. This handles cases where messages arrive out of order or across different folders.

### Sent Message Categorization

`processMessage` must check whether the message is from an inbox folder before setting categorization flags. Sent folder messages skip categorization entirely.

### Sync Lock

Atomic check prevents concurrent syncs: `isSyncing = false OR syncStartedAt > 5 minutes ago`. Stale locks (from crashes) auto-clear after 5 minutes.

### Edge Runtime

`middleware.ts` cannot import anything that uses Node.js `crypto`. The auth config is split specifically for this reason — `auth.config.ts` is edge-safe, `auth.ts` has full Node.js dependencies.

### Single-Process Constraint

ConnectionManager (IDLE daemon), SSE subscriber registry, and echo suppression state all use in-memory data structures. They must run in the same Node.js process — no distributed worker support.

### Cache Invalidation Pattern

After any mutation that changes message counts or visibility:

1. `revalidateTag("sidebar-counts")` — refreshes sidebar badge counts
2. `revalidatePath("/affected-page")` — refreshes page data for affected categories

### Multi-Tenant Security

All database queries filter by `userId`. Server actions verify ownership before mutations. No cross-user data access is possible.

---

## File Structure

```
kurir-server/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── search_vector.sql
├── scripts/
│   ├── add-user.ts
│   ├── sync-user.ts
│   ├── list-users.ts
│   └── migrate-to-passkey-auth.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout (html, body, providers)
│   │   ├── page.tsx                      # Redirect → /imbox
│   │   ├── globals.css
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── setup/page.tsx
│   │   ├── (mail)/
│   │   │   ├── layout.tsx                # Sidebar, IDLE start, sidebar counts
│   │   │   ├── imbox/page.tsx
│   │   │   ├── imbox/[id]/page.tsx       # Thread detail
│   │   │   ├── feed/page.tsx
│   │   │   ├── feed/[id]/page.tsx
│   │   │   ├── paper-trail/page.tsx
│   │   │   ├── paper-trail/[id]/page.tsx
│   │   │   ├── screener/page.tsx
│   │   │   ├── archive/page.tsx
│   │   │   ├── archive/[id]/page.tsx
│   │   │   ├── snoozed/page.tsx
│   │   │   ├── snoozed/[id]/page.tsx
│   │   │   ├── sent/page.tsx
│   │   │   ├── sent/[id]/page.tsx
│   │   │   ├── contacts/page.tsx
│   │   │   ├── contacts/[id]/page.tsx
│   │   │   ├── compose/page.tsx
│   │   │   └── settings/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── auth/webauthn/register/options/route.ts
│   │       ├── auth/webauthn/register/verify/route.ts
│   │       ├── auth/webauthn/login/options/route.ts
│   │       ├── auth/webauthn/login/verify/route.ts
│   │       ├── auth/webauthn/passkeys/[id]/route.ts
│   │       ├── connections/route.ts
│   │       ├── messages/route.ts
│   │       ├── mail/sync/route.ts
│   │       ├── mail/send/route.ts
│   │       ├── mail/events/route.ts
│   │       ├── attachments/[id]/route.ts
│   │       └── contacts/search/route.ts
│   ├── actions/
│   │   ├── archive.ts
│   │   ├── senders.ts
│   │   ├── reply.ts
│   │   ├── snooze.ts
│   │   └── sidebar.ts
│   ├── components/
│   │   ├── providers.tsx                 # React Query + Zustand providers
│   │   ├── ui/                           # shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   └── popover.tsx
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   └── mobile-sidebar.tsx
│   │   ├── mail/
│   │   │   ├── message-list.tsx
│   │   │   ├── infinite-message-list.tsx
│   │   │   ├── thread-view.tsx
│   │   │   ├── email-body-frame.tsx
│   │   │   ├── reply-composer.tsx
│   │   │   ├── archive-button.tsx
│   │   │   ├── snooze-button.tsx
│   │   │   ├── search-input.tsx
│   │   │   ├── auto-sync.tsx
│   │   │   └── selection-action-bar.tsx
│   │   ├── screener/
│   │   │   ├── screener-view.tsx
│   │   │   └── screened-sender-list.tsx
│   │   ├── settings/
│   │   │   ├── connections-list.tsx
│   │   │   ├── connection-card.tsx
│   │   │   ├── passkeys-list.tsx
│   │   │   └── passkey-card.tsx
│   │   └── contacts/
│   │       ├── contact-list.tsx
│   │       └── contact-thread-list.tsx
│   ├── lib/
│   │   ├── auth.ts                       # NextAuth full config + helpers
│   │   ├── auth.config.ts                # Edge-safe auth config
│   │   ├── db.ts                         # Prisma singleton
│   │   ├── crypto.ts                     # AES-256-GCM encrypt/decrypt
│   │   ├── date.ts                       # Date formatting utilities
│   │   ├── utils.ts                      # cn() helper (clsx + tailwind-merge)
│   │   ├── webauthn-challenge-store.ts   # In-memory challenge storage
│   │   └── mail/
│   │       ├── sync-service.ts           # IMAP sync engine
│   │       ├── imap-client.ts            # withImapConnection() helper
│   │       ├── imap-verify.ts            # IMAP credential verification
│   │       ├── connection-manager.ts     # IDLE daemon + persistent connections
│   │       ├── idle-handlers.ts          # IDLE event handlers
│   │       ├── sse-subscribers.ts        # Real-time event bus
│   │       ├── messages.ts              # Message queries + cursor pagination
│   │       ├── threads.ts               # Thread utilities
│   │       ├── search.ts               # Full-text search
│   │       ├── sanitize-html.ts         # DOMPurify email sanitization
│   │       ├── quote-utils.ts           # Quote text extraction
│   │       ├── persist-sent.ts          # Local sent message creation
│   │       ├── pending-senders.ts       # Screener query filters
│   │       └── flag-push.ts             # Push flag changes to IMAP
│   ├── types/                            # TypeScript type definitions
│   └── middleware.ts                     # Route protection
├── docker-compose.yml
├── Dockerfile
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```
