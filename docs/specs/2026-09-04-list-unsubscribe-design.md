# List-Unsubscribe for The Feed - design

Date: 2026-09-04. Status: spike. Do not implement until the maintainer
accepts this spec (especially SSRF pin and mailto vs POST).

The Feed is the newsletter list. Today the only exits are recategorize or
`rejectSender` (screen out). The list keeps mailing. RFC 2369
`List-Unsubscribe` and RFC 8058 `List-Unsubscribe-Post` are how clients
offer one-click leave. Kurir does not store those headers.

Unsubscribe is not screen-out.

## Ingest source (mailparser, not a second parser)

`processMessage` already runs `simpleParser(msg.source)` at
`src/lib/mail/sync-service.ts:572`. mailparser `ParsedMail.headers` is a
`Map` with lowercase keys (`@types/mailparser` `ParsedMail.headers`).

Persist:

- `parsed.headers.get("list-unsubscribe")` as text
- `parsed.headers.get("list-unsubscribe-post")` as text

If the Map value is not a string, `String(value)` once at ingest. Do not
add a second header parser. `headerLines` is a fallback only if `.get`
is empty in a unit experiment; default is `.get`.

Repo-wide `List-Unsubscribe` is still unused in `src/` and `prisma/`
(this spec is the first mention besides the plan).

## Decisions

### 1. Storage

Recommend nullable text columns on `Message`:

- `listUnsubscribe`
- `listUnsubscribePost`

Not a side table (one-to-one with the message, read on thread open).
Not JSON stuffing (settings-backup already says not to depend on custom
headers in takeout; columns stay off the backup payload).

Implementation needs a numbered idempotent SQL file
(`002N_list_unsubscribe.sql`, `ADD COLUMN IF NOT EXISTS`). Never
`prisma db push` on a non-empty database.

### 2. When to show the control

Recommend Feed thread toolbar plus Feed list overflow, gated on
`isInFeed` and a non-empty `listUnsubscribe`. Not Imbox, not Paper Trail,
not Screener. Recategorize-out-of-Feed hides it.

### 3. HTTPS one-click vs mailto

Recommend:

- When `listUnsubscribePost` is present, POST the HTTPS URL from
  `List-Unsubscribe` with body `List-Unsubscribe=One-Click` (RFC 8058).
- `mailto:` is a compose-prefill, not a silent GET or POST.
- **Never GET an unsubscribe URL as a side effect of opening the thread.**
  Opening the thread only reads stored columns.

### 4. SSRF

Unsubscribe URLs are fetched by our server, not the browser.

Reuse the ICS public-destination check (`assertPublicHttpsUrl` in
`src/lib/calendar/ics-url.ts:80`) and, once P1 plan 039 is merged, the
DNS-pinned GET (`ics-pinned.ts`). Refuse `http:`, private IPs, and
redirects to private. Follow-on STOP if the pin helper is not on `main`.

### 5. Authz

Server action: auth check, then load the message with `{ id, userId }`.
One-click POST from the Kurir server so list operators see our IP, not
the user's browser or UA.

### 6. Relation to screen-out

Unsubscribe does not call `rejectSender`. UI sentence:

"Stop this list. The sender stays in The Feed unless you screen them out."

### 7. Web vs iOS v1

Web-only. Do not add the columns to `MESSAGE_SELECT` / mobile sync until
iOS has a control. A new column on Message does not have to ship in the
mobile contract for v1.

### 8. Open questions

- Gmail combo headers (`<https://...>, <mailto:...>`): parse the first
  https URL for POST; keep mailto for the compose fallback.
- Malformed headers: hide the control; do not throw on thread open.
- After success: hide the control on that message. Do not strip the
  stored columns (useful if the POST is retried).
- Success should not archive. The user asked to leave the list, not to
  file the thread.

## Non-goals (v1)

- iOS / macOS
- GET-based unsubscribe
- Mixing with `rejectSender`
- Settings backup of the new columns
- Scanning historical mail (new ingest only, plus optional later backfill)
