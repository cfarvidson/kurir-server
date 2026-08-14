# Kurir MCP server (2026-07-28) - design

Date: 2026-08-14. Status: approved in dialog (sections 1-4).

Remote HTTP MCP so Claude.ai, Claude Desktop, Claude Code, and other
MCP 2026-07-28 clients can do mail plus the user's own settings against a
self-hosted Kurir instance.

## Goal

A user adds `https://<KURIR_DOMAIN>/mcp` as a custom connector. They sign in
with the same passkey they use for the PWA, approve a consent screen, and then
an agent can read, search, triage, screen, compose (with extra confirmation),
and change that user's own settings.

## Non-goals (v1)

- Admin (users, invites, health, updates) and wipe
- Adding an email connection (IMAP password or provider OAuth)
- Registering a new passkey
- MCP Apps, Tasks, resources, prompts, `subscriptions/listen`
- stdio transport
- Dynamic Client Registration
- Backward compatibility with MCP revisions that require `initialize` / sessions
- Push-notification subscribe/unsubscribe
- Historical mail import

## Locked decisions

- Transport: remote Streamable HTTP. Endpoint `POST /mcp`.
- Spec: MCP 2026-07-28 only. Stateless. No `initialize`, no `Mcp-Session-Id`.
- Hosting: inside the existing Next.js app. No extra process or Kamal service.
- Capability surface: mail + own settings. Not admin, not wipe.
- Auth: Kurir is both resource server and authorization server. One grant
  covers the whole v1 surface. Passkey session is required to consent.
- Dangerous writes use MRTR elicitation (`input_required`) before execution.
- Tools only. No resources or prompts in v1.
- Protocol implementation: a local dispatcher in `src/lib/mcp/`. Do not wrap
  the official SDK in v1 (Next.js + 2026-07-28 sessionless binding is simpler
  to own). Use the published schema as the source of truth for field names.
- Client registration: Client ID Metadata Documents (CIMD) only.

## Architecture

Kurir is the MCP resource server and its own OAuth 2.1 authorization server
on the same origin as the PWA.

```
Claude client
  POST https://<KURIR_DOMAIN>/mcp
    Authorization: Bearer <opaque access token>
    MCP-Protocol-Version: 2026-07-28
    Mcp-Method: tools/call
    Mcp-Name: search_mail
  -> src/app/mcp/route.ts
  -> verify McpToken (hashed, unexpired, audience = https://<base>/mcp)
  -> src/lib/mcp/protocol.ts dispatch
  -> tool in src/lib/mcp/tools/*
  -> existing src/lib/mail/* (same functions as /api/mobile)
```

Unauthenticated `POST /mcp` must reach the route handler and return HTTP 401
JSON plus `WWW-Authenticate`. It must not redirect to `/login`. Discovery and
token endpoints are public. `/oauth/authorize` is a browser page and uses the
existing passkey login + `next` redirect.

### File layout

```
src/lib/mcp/
  protocol.ts         # JSON-RPC dispatch, version, header checks
  auth.ts             # bearer verify, audience, 401 challenge
  oauth.ts            # PKCE, CIMD fetch/validate, codes, tokens
  confirmations.ts    # MRTR handles
  serialize.ts        # list/thread/settings shapes
  tools/index.ts      # registry + annotations
  tools/mail.ts
  tools/send.ts
  tools/screener.ts
  tools/contacts.ts
  tools/settings.ts
src/app/mcp/route.ts                          # POST + OPTIONS
src/app/.well-known/oauth-protected-resource/route.ts
src/app/.well-known/oauth-authorization-server/route.ts
src/app/(auth)/oauth/authorize/page.tsx       # consent UI
src/app/api/oauth/token/route.ts              # token endpoint
src/components/settings/mcp-connections.tsx   # list + revoke
prisma/migrations/0013_mcp.sql
```

Token URL is `/api/oauth/token` so it sits with other POST APIs. Authorize is
`/oauth/authorize` so it can use the session cookie and login `next` flow.

### Proxy (`src/proxy.ts`)

Allow through without a session cookie:

- `/mcp` (including OPTIONS)
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/api/oauth/token`

`/oauth/authorize` stays behind the existing login redirect
(`/login?next=/oauth/authorize?...`). Existing `next` validation already
accepts a same-origin path plus query string.

### CORS

Claude.ai calls `/mcp` and the well-known/token endpoints from a browser.
No cookies, so `Access-Control-Allow-Origin: *` is correct.

`/mcp` and `/api/oauth/token`:

```
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name
```

Well-known GET routes also allow `GET`. Authorize HTML does not need CORS.

## Protocol

Only `MCP-Protocol-Version: 2026-07-28` (header) and the same version in
request `_meta`. Older versions return a JSON-RPC error that names the
supported version. No initialize fallback.

`POST /mcp` accepts a single JSON-RPC request. Response is a single JSON
object (`Content-Type: application/json`). No SSE in v1. `GET /mcp` and
`DELETE /mcp` return 405.

Required headers on every POST: `MCP-Protocol-Version`, `Mcp-Method`.
`Mcp-Name` is required when the method is `tools/call`. The JSON body is the
source of truth. If a header disagrees with the body, reject the request.

Supported methods:

| Method            | Behavior                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `server/discover` | Server info + capabilities (`tools`). No resources, prompts, or tasks.                            |
| `tools/list`      | Full tool catalog. `ttlMs: 300000`, `cacheScope: "server"` (catalog is identical for every user). |
| `tools/call`      | Validate args with Zod, run the tool or return `input_required`.                                  |

Unknown method or tool: JSON-RPC error. Application failures (not found,
validation, IMAP down, denied confirmation): `tools/call` result with
`isError: true` and a short English message. Agents must be able to read
those without a 500.

Every DB read and write filters by the token's `userId`. A missing row is
reported as "not found or not yours". No existence leak across users.

## OAuth

Kurir implements the MCP 2026-07-28 authorization profile.

### Discovery

Protected resource metadata (`GET /.well-known/oauth-protected-resource`):

- `resource`: `https://<base>/mcp` (no trailing slash)
- `authorization_servers`: `[ "<base>" ]`
- `scopes_supported`: `["kurir"]`
- `bearer_methods_supported`: `["header"]`

`<base>` is `getConfig().baseUrl` (from `KURIR_DOMAIN` / `NEXTAUTH_URL`).
Localhost uses `http`.

Authorization server metadata
(`GET /.well-known/oauth-authorization-server`):

- `issuer`: `<base>`
- `authorization_endpoint`: `<base>/oauth/authorize`
- `token_endpoint`: `<base>/api/oauth/token`
- `code_challenge_methods_supported`: `["S256"]`
- `response_types_supported`: `["code"]`
- `grant_types_supported`: `["authorization_code", "refresh_token"]`
- `authorization_response_iss_parameter_supported`: `true`
- `token_endpoint_auth_methods_supported`: `["none"]` (public clients)
- CIMD advertised as supported. No DCR endpoint.

Unauthenticated `/mcp` response:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource", scope="kurir"
```

One scope, `kurir`. No step-up scopes in v1. The host's own tool confirmation
is not a substitute for MRTR on the dangerous tools listed below.

### Authorize

`GET /oauth/authorize` query: `client_id`, `redirect_uri`, `response_type=code`,
`code_challenge`, `code_challenge_method=S256`, `resource`, `state` (optional),
`scope` (optional).

Rules:

1. `response_type` must be `code`. `code_challenge_method` must be `S256`.
2. `resource` must equal the canonical MCP URI `https://<base>/mcp`
   (http on localhost).
3. `client_id` must be an `https://` URL (CIMD). Fetch the document, require
   `redirect_uris` to contain the exact `redirect_uri`. Cache CIMD JSON in
   Redis for 5 minutes keyed by URL. Fail closed if the fetch fails or the
   document is invalid.
4. User must have a NextAuth session. If not, redirect to
   `/login?next=<authorize URL>`.
5. Consent page (English): client name from CIMD, short description
   "Mail and your account settings on this Kurir instance", Approve / Deny.
6. Approve: persist a hashed one-time authorization code (TTL 2 minutes)
   bound to `userId`, `clientId`, `redirectUri`, `codeChallenge`, `resource`.
   Redirect to `redirect_uri` with `code`, `state` if present, and `iss=<base>`
   (RFC 9207).
7. Deny: redirect with `error=access_denied` and `iss`.
8. Reject open redirects: only the CIMD-listed `redirect_uri` is used. Never
   echo a client-supplied URL that failed the CIMD check.

### Token

`POST /api/oauth/token`, `application/x-www-form-urlencoded`.

`authorization_code` grant: `code`, `redirect_uri`, `client_id`,
`code_verifier`, `resource`. Validate PKCE S256, exact redirect, unexpired
unused code, client_id match, resource match, then issue tokens and delete
the code.

`refresh_token` grant: rotate both tokens in place (same `updateMany` race
pattern as `MobileToken`). Unknown or already-rotated refresh returns
invalid_grant.

Tokens are opaque 32-byte base64url values, stored SHA-256 hashed. Access
TTL 1 hour. Refresh has no fixed TTL; revoke deletes the row. Each consent
creates a new `McpToken` row. Audience is stored on the row and checked on
every `/mcp` call.

Public clients: no client secret.

### Settings UI

A "Connected apps" section on the PWA settings page lists the user's
`McpToken` rows: client name, created at, last used. Revoke deletes the row
immediately. No admin view in v1.

## Data model

Migration `0013_mcp.sql`, idempotent (`IF NOT EXISTS`), applied by
`scripts/apply-migrations.sh`. Do not use `prisma db push` for this.

```
McpAuthorizationCode
  id, createdAt
  codeHash          String @unique
  userId            -> User
  clientId          String          // CIMD URL
  redirectUri       String
  codeChallenge     String          // S256 challenge
  resource          String
  expiresAt         DateTime

McpToken
  id, createdAt
  userId            -> User
  clientId          String
  clientName        String?
  accessTokenHash   String @unique
  refreshTokenHash  String @unique
  accessTokenExpiresAt DateTime
  resource          String
  lastUsedAt        DateTime

McpConfirmation
  id                String @id      // handle returned to the client
  createdAt
  userId            -> User
  tokenId           -> McpToken
  toolName          String
  argsHash          String          // SHA-256 of canonical JSON args
  argsJson          Json            // exact args, for re-check and display
  expiresAt         DateTime
  consumedAt        DateTime?
```

Cascade delete from User. Cascade `McpConfirmation` from `McpToken` so revoke
invalidates in-flight confirms.

Canonical args JSON: UTF-8, sorted object keys, no insignificant whitespace.
Hash that string.

## Tools

Optional `connectionId` on tools that are account-scoped. If omitted, use the
user's default `EmailConnection`. If the user has no connections, tools that
need one return `isError`.

`list_mail` views: `imbox`, `feed`, `paper_trail`, `screener`, `archive`,
`sent`, `snoozed`, `follow_up`, `reply_later`, `drafts`, `scheduled`, `files`.

Pagination: `{ items, nextCursor }`. `nextCursor` is omitted when there is
no further page. Default page size 25, max 50.

Dates in ISO-8601. IDs are Kurir cuids.

### Read

| Tool             | Args                                              | Result                                                          |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `list_mail`      | `view`, `cursor?`, `unreadOnly?`, `connectionId?` | Compact thread/message rows                                     |
| `get_thread`     | `messageId`                                       | Thread messages in chronological order                          |
| `search_mail`    | `q`, `limit?` (default 20, max 50)                | Compact rows, FTS rank order (same `searchMessages` as PWA/iOS) |
| `get_counts`     |                                                   | Sidebar counts (same source as the PWA sidebar)                 |
| `get_attachment` | `attachmentId`                                    | See below                                                       |

Compact row: `id`, `threadId`, `from`, `to`, `subject`, `date`, `snippet`,
`isRead`, `isInImbox`, `isInFeed`, `isInPaperTrail`, `isArchived`,
`isInScreener`, plus view-specific flags (`snoozedUntil`, `followUpUntil`,
`replyLater`, scheduled time). No HTML bodies in lists.

`get_thread`: each message has `id`, `from`, `to`, `cc`, `date`, `subject`,
sanitized plain text (`text` or stripped HTML), and `attachments[]`
(`id`, `filename`, `contentType`, `size`). Use the same sanitizer as the
PWA body endpoint.

`get_attachment`:

- `text/*` and small images (`image/jpeg`, `image/png`, `image/gif`,
  `image/webp`) under 1 MB: inline (`text` or base64).
- Anything else, or any file over 1 MB: metadata only plus
  `openInApp: true`. No arbitrary binary dump.

### Writes that run immediately

| Tool                                                                    | Args                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update_thread`                                                         | `messageId`, `action`, plus `until?` for snooze/follow_up                                                                                                                                                               |
| `save_draft`                                                            | same schema as `saveDraftForUser`: `type` (`NEW` \| `REPLY` \| `FORWARD`), `contextMessageId` (message id, or `"__new__"` for `NEW`), `to?`, `cc?`, `bcc?`, `subject?`, `body?`, `emailConnectionId?`, `attachmentIds?` |
| `delete_draft`                                                          | `type`, `contextMessageId` (same key as the PWA/mobile drafts table; no separate draft id)                                                                                                                              |
| `update_scheduled`                                                      | `id`, fields the existing edit path accepts (to/cc/bcc, subject, body, `scheduledFor`)                                                                                                                                  |
| `cancel_scheduled`                                                      | `id`                                                                                                                                                                                                                    |
| `screen_sender`                                                         | `senderId`, `action`: `approve` \| `skip` \| `unskip` \| `undo`; `category` required for `approve` (`IMBOX` \| `FEED` \| `PAPER_TRAIL`)                                                                                 |
| `update_sender`                                                         | `senderId`, optional `category`, `unthread`, `allowImages`                                                                                                                                                              |
| `list_domain_rules`                                                     |                                                                                                                                                                                                                         |
| `create_domain_rule`                                                    | `senderId` or `pattern`, `includeSubdomains`, `status`, `category?`                                                                                                                                                     |
| `update_domain_rule`                                                    | `ruleId`, `category`                                                                                                                                                                                                    |
| `delete_domain_rule`                                                    | `ruleId`                                                                                                                                                                                                                |
| `list_contacts` / `get_contact` / `search_contacts`                     | `q?`, `cursor?`                                                                                                                                                                                                         |
| `create_contact` / `update_contact`                                     | name + emails as in PWA actions                                                                                                                                                                                         |
| `list_contact_groups` / `create_contact_group` / `update_contact_group` | `update` is rename + default target, same as PWA                                                                                                                                                                        |
| `add_group_member` / `remove_group_member`                              |                                                                                                                                                                                                                         |
| `sync_mail`                                                             | `connectionId?`                                                                                                                                                                                                         |
| `get_sync_status`                                                       | `connectionId?`                                                                                                                                                                                                         |
| `get_settings` / `update_settings`                                      | see below                                                                                                                                                                                                               |
| `list_connections`                                                      | no secrets, no encrypted password                                                                                                                                                                                       |
| `update_connection`                                                     | `connectionId`, `displayName?`, `isDefault?`, `sendAsEmail?`, `aliases?`, `treatDomainAsOwn?`                                                                                                                           |
| `list_passkeys`                                                         | id, friendlyName, createdAt, last used if stored. Never credential material.                                                                                                                                            |

`update_thread.action`: `archive`, `unarchive`, `read`, `unread`, `snooze`,
`unsnooze`, `follow_up`, `dismiss_follow_up`, `reply_later`,
`clear_reply_later`. `until` is required for `snooze` and `follow_up`.

`create_domain_rule` with `status: "APPROVED"` runs immediately.
`status: "REJECTED"` is MRTR (below).

`update_settings` fields (all optional, only provided keys change):
`displayName`, `theme` (`light` \| `dark` \| `system`), `timezone` (IANA),
`blockRemoteImages`, `blockTrackers`, and the existing badge booleans
(`showImboxBadge`, ...). Push subscription is not included.

`update_connection` and `delete_connection` must honor
`canManageConnections`. If self-service is off, return `isError` with the
same "contact your admin" meaning as the PWA.

`sync_mail` uses `rateLimitSync`. It starts the existing sync job and
returns the current status. It does not wait for IMAP to finish.

### Writes that require MRTR

These tools create a `McpConfirmation` (TTL 10 minutes, single use) and
return `input_required` with a confirmation elicitation. They do not mutate
mail until a retry arrives with a matching `inputResponses` accept.

| Tool                                           | Confirmation must show                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `send_mail`                                    | mode, from connection, to, cc, bcc, subject, body preview (first 500 chars) |
| `schedule_mail`                                | same plus `scheduledFor`                                                    |
| `send_scheduled_now`                           | to, subject, scheduled id                                                   |
| `screen_sender` with `action: "reject"`        | sender email and display name                                               |
| `create_domain_rule` with `status: "REJECTED"` | pattern, includeSubdomains                                                  |
| `delete_contact`                               | contact name and emails                                                     |
| `delete_contact_group`                         | group name                                                                  |
| `delete_connection`                            | connection email; refuse if it is the user's only connection                |
| `revoke_passkey`                               | passkey friendly name                                                       |
| `bulk_approve_old_senders`                     | `days` and the count that would be approved                                 |

`send_mail` args:

- `mode`: `compose` \| `reply` \| `reply_all` \| `forward`
- `connectionId?`
- `messageId?` required for reply / reply_all / forward
- `to` (array of addresses; for reply modes, server fills defaults if omitted)
- `cc?`, `bcc?`
- `subject?` (reply uses `Re:` default if omitted)
- `body` string. Same markdown-to-email path as `/api/mail/send`
- `attachmentIds?` already-uploaded attachment ids owned by the user

`schedule_mail` is `send_mail` plus required `scheduledFor` (ISO datetime).

Demo instances: send/schedule tools return `isError` ("Sending is disabled on
this demo instance.") and must not create a confirmation.

`upload_attachment`: `filename`, `contentType`, `data` (base64), max 5 MB
decoded. Reuse `rateLimitUploads` and the existing attachment store. Returns
`{ id }` for `send_mail.attachmentIds`. Not MRTR.

### Tool annotations

Mark read-only tools `readOnlyHint: true`. Mark MRTR tools
`destructiveHint: true`. `send_mail` / `schedule_mail` also
`openWorldHint: true` (mail leaves the system).

## MRTR flow

Dangerous tools use MCP `InputRequiredResult` (`resultType: "input_required"`).

If the client's `_meta` capabilities do not include elicitation, those tools
return `isError: true` ("this client cannot confirm this action") and do not
mutate anything. They do not return `input_required`.

Otherwise:

1. Server inserts `McpConfirmation` and returns:

```
resultType: "input_required"
requestState: "<confirmation id>"
inputRequests.confirm:
  method: "elicitation/create"
  params:
    mode: "form"
    message: "<human-readable summary from the table above>"
    requestedSchema:
      type: object
      properties: {}
```

`requestState` is the confirmation row id. Integrity is the DB row (user,
token, tool, args hash, expiry, single-use), not a client-trusted blob.

2. Client retries the same `tools/call` (same tool name and args) with
   the echoed `requestState` and `inputResponses.confirm`.
3. Server loads `requestState` as the confirmation id. Checks `userId`,
   `tokenId`, `toolName`, `argsHash`, `expiresAt`, `consumedAt is null`.
4. `action` other than `accept` (including `decline` / `cancel` / missing):
   mark consumed, return `isError` "cancelled". No send, no reject, no delete.
5. `action: "accept"`: mark consumed in the same transaction that performs
   the mutation so a retry cannot fire twice.
6. Args that do not match the hash, or a `requestState` that is unknown,
   expired, consumed, or bound to another token: `isError` "confirmation
   does not match arguments". Do not execute.

Revoking the `McpToken` deletes pending confirmations (cascade).

## Rate limits

Reuse the existing Redis helpers (fail open if Redis is down):

- Every authenticated `/mcp` call: `rateLimitUser` (120/min).
- `send_mail`, `schedule_mail`, `send_scheduled_now`: also `rateLimitSend`
  (30/10 min).
- `sync_mail`: `rateLimitSync` (1/30s).
- `upload_attachment`: `rateLimitUploads` (30/min).
- Authorize + token + CIMD-driven authorize GETs:
  `rateLimitOAuth(ip)` at 30 per 10 minutes (new helper, same pattern as
  `rateLimitMobileLogin`).

Exceeded: HTTP 429 with `retryAfter` on the `/mcp` POST, or OAuth
`invalid_request` / slow-down on token. Tool-level send limit is a tool
`isError` if the request already passed the POST limiter.

## Errors

| Situation                                                      | Response                               |
| -------------------------------------------------------------- | -------------------------------------- |
| No/invalid/expired access token                                | HTTP 401 + `WWW-Authenticate` as above |
| Token audience != `/mcp`                                       | HTTP 401                               |
| Header/body method mismatch, bad JSON-RPC, unsupported version | JSON-RPC error                         |
| Unknown tool, bad args, not found, denied, IMAP/SMTP failure   | `tools/call` result `isError: true`    |
| Rate limited                                                   | HTTP 429                               |

Do not log mail bodies, authorization codes, or raw tokens at info level.

## Settings copy and docs

- Consent page and settings "Connected apps" UI: English.
- README: one section "Claude / MCP" with the connector URL
  `https://<domain>/mcp` and the passkey consent flow.

## Testing

Vitest, mocked Prisma / Redis / fetch. No live IMAP.

Unit (`src/__tests__/unit/`):

- Dispatcher: version, `Mcp-Method` / `Mcp-Name`, header/body mismatch,
  unknown method/tool.
- OAuth: PKCE success/fail, `iss` on redirect, one-time and expired code,
  refresh rotation race, audience check, CIMD redirect allow/deny, open
  redirect rejected.
- MRTR: matching hash executes once, mismatch does not send, expired handle,
  deny, revoke-token cancels pending.
- Serializers: compact list shape, "not found or not yours", default
  `connectionId`.

Integration (`src/__tests__/integration/`):

- `POST /mcp` with a test token: `server/discover`, `tools/list`,
  `list_mail`, `search_mail`, `update_thread`.
- `send_mail` without confirm -> `input_required`; retry with accept sends
  (SMTP stubbed like existing send tests); wrong hash does not send.
- 401 without token includes `resource_metadata`.
- Well-known documents parse and point at `/oauth/authorize` and
  `/api/oauth/token`.

Do not re-test `src/lib/mail/mutations.ts` here.

## Definition of done

A user can add `https://<their-kurir>/mcp` in Claude, sign in with a
passkey, approve consent, then: list Imbox, read a thread, search, archive,
screen a sender, send mail after the MRTR prompt, read and update own
settings, and revoke the app under Settings. `pnpm test` and `pnpm lint`
pass. Admin and wipe are not in `tools/list`.

## Implementation notes

- Extract shared "userId-first" helpers from server actions when a tool
  would otherwise have to fake a NextAuth session. Prefer calling
  `src/lib/mail/*` (already used by `/api/mobile/actions`) over importing
  `"use server"` files.
- `revalidateTag("sidebar-counts")` after mutations that change counts, same
  as PWA/mobile.
- New SQL must be idempotent. Next free migration number at spec time is
  `0013_mcp.sql` (verify against `prisma/migrations/` before writing).
- UI for consent and Connected apps follows `DESIGN.md` (terracotta, Inter,
  no avatars).
