# UX Spec: Auth Redesign — Passkey + Multi-Email Connections

**Author:** ux-specialist
**Date:** 2026-03-01
**Feature:** Auth redesign — passkey authentication + multi-email connections
**Scope:** kurir-server only

---

## Overview

This document specifies the user experience for the auth redesign. The core change: Kurir users now have an **account identity** (authenticated via passkey/WebAuthn) that is separate from their **email connections** (IMAP/SMTP accounts). A user registers once, then links one or more email accounts.

### User Mental Model

**Before:** "My Kurir account IS my email account."
**After:** "My Kurir account manages my email accounts."

This distinction must be communicated clearly during onboarding and never assumed to be self-evident.

---

## 1. User Stories

| Story                    | Who                | What                                             | Why                                           |
| ------------------------ | ------------------ | ------------------------------------------------ | --------------------------------------------- |
| Registration             | New user           | Create a Kurir account using a passkey           | No password to forget; device-native security |
| Login                    | Returning user     | Sign in instantly with a passkey                 | Fast, frictionless, no password typing        |
| Add email                | Authenticated user | Connect an IMAP/SMTP email account               | Access and manage that inbox in Kurir         |
| Remove email             | Authenticated user | Disconnect an email account                      | Clean up unused accounts                      |
| Send from specific email | Authenticated user | Pick which email to send from in compose         | Control which address appears as sender       |
| Manage connections       | Authenticated user | View and manage all connected emails in settings | Overview and control of linked accounts       |

---

## 2. Flow 1 — Passkey Registration (`/register`)

### User Goal

Create a new Kurir account with a passkey. No email or password required for account creation.

### Happy Path

```
1. User navigates to /register
2. Sees registration card with display name field + "Create account" button
3. Enters optional display name
4. Clicks "Create account with passkey"
5. OS/browser native passkey dialog appears (Touch ID, Face ID, Windows Hello, etc.)
6. User authenticates with biometric/PIN
7. Account created → session established → redirected to /setup (add first email)
```

### Decision Points

```
[User on /register]
     |
     v
[Has existing account?]
  YES → link to /login
  NO  → proceed with registration
     |
     v
[Passkey dialog shown]
     |
     +--> [User cancels] → show "Registration cancelled. Try again." inline error
     |
     +--> [Device has no biometric] → show fallback: "Use a PIN or security key"
     |
     v
[Registration success] → redirect to /setup
```

### Wireframe — `/register`

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              [Kurir logo / Mail icon]               │
│                                                     │
│            Create your Kurir account                │
│      Sign in securely with a passkey — no           │
│             password required                       │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Display name (optional)                      │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ [person icon]  Your name                │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  [passkey icon]  Create account         │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  [error message area — hidden by default]     │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│     Already have an account?  Sign in               │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  [Passkey icon]  What is a passkey?                 │
│  Passkeys use your device's biometrics or PIN       │
│  to sign in — no password needed.                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Interaction Spec

- **Display name field:** Optional. Placeholder: "Your name". If empty, defaults to empty string (can be set later in settings).
- **"Create account" button:** Primary, full-width. Icon: passkey/fingerprint icon (e.g. `KeyRound` from lucide).
- **Loading state:** Button shows spinner + "Creating account..." during WebAuthn ceremony.
- **Error states:**
  - `NotAllowedError` (user cancelled): "Registration was cancelled. Please try again."
  - `InvalidStateError` (passkey already exists on device for this origin): "A passkey for this device already exists. Try signing in instead."
  - Generic failure: "Something went wrong. Please try again."
- **"What is a passkey?" explainer:** Collapsed by default, expandable. Keep it short. Normalises passkeys for users unfamiliar with the concept.
- **"Already have an account?" link:** Routes to `/login`.

### Accessibility

- `role="main"` on the card container
- Display name `<input>` has `aria-label="Display name (optional)"`
- "Create account" button has `aria-busy="true"` + `aria-label="Creating account, please wait"` during loading
- Error messages use `role="alert"` so screen readers announce them immediately
- "What is a passkey?" uses a `<details>`/`<summary>` element for native keyboard expand/collapse

### Responsive Behavior

- **Mobile (< 640px):** Card fills full screen, no shadow. Padding 16px.
- **Tablet/Desktop (>= 640px):** Card centered, max-width 448px, shadow. Background: `bg-gradient-to-br from-purple-50 to-white` (matches existing pattern).

---

## 3. Flow 2 — Passkey Login (`/login`)

### User Goal

Sign in to an existing Kurir account using a passkey. Must be fast and frictionless.

### Happy Path (Conditional UI / Autofill)

```
1. User navigates to /login
2. Page loads — conditional UI passkey autofill is immediately initiated in background
3. User clicks into the "email or username" hint field (optional visual affordance)
4. Browser shows passkey autofill suggestion in native dropdown (no button press needed)
5. User selects their passkey → authenticates with biometric
6. Session created → redirected to /imbox
```

### Happy Path (Explicit Button)

```
1. User navigates to /login
2. Sees "Sign in with passkey" button
3. Clicks button → OS/browser native passkey dialog appears
4. User authenticates with biometric/PIN
5. Session created → redirected to /imbox
```

### Decision Points

```
[User on /login]
     |
     v
[Does browser support conditional UI?]
  YES → initiate conditional UI in background immediately on page load
  NO  → show only explicit button, no autofill hint field
     |
     v
[User interaction]
     |
     +--> [Clicks autofill / explicit button → auth succeeds] → /imbox
     |
     +--> [Clicks explicit button → user cancels] → show inline error, stay on /login
     |
     +--> [No passkey on this device] → show "Use a different device" guidance
     |
     +--> [No account at all] → link to /register
```

### Wireframe — `/login`

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              [Kurir logo / Mail icon]               │
│                                                     │
│                  Welcome back                       │
│            Sign in to your Kurir account            │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │  [error message area — hidden by default]     │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  [passkey icon]  Sign in with passkey   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  ─────────── or ─────────────────────────     │  │
│  │                                               │  │
│  │  [hint input — triggers autofill]             │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  Sign in with saved passkey...          │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  (hidden if conditional UI not supported)     │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│          No account yet?  Create one                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Interaction Spec

**Conditional UI (autofill):**

- On mount, call `startAuthentication({ mediation: 'conditional' })` from `@simplewebauthn/browser`.
- The hint input field (`autocomplete="username webauthn"`) is required for the browser to know where to show the autofill dropdown.
- The conditional UI request runs silently — no loading spinner, no disruption.
- If the user clicks the explicit button while conditional UI is pending, abort the conditional UI request and start a modal request.

**Explicit "Sign in with passkey" button:**

- Primary, full-width.
- Loading state: spinner + "Signing in..."
- Abort any in-flight conditional UI before starting explicit flow.

**Error states:**

- `NotAllowedError` (cancelled): "Sign-in was cancelled."
- `NotSupportedError` (no passkey on device): "No passkey found for this device. Did you register on a different device?"
- Generic: "Sign-in failed. Please try again."

**"No account yet?" link:** Routes to `/register`.

### Accessibility

- Hint input: `id="passkey-hint"`, `autocomplete="username webauthn"`, `aria-label="Sign in with a saved passkey"`, `tabindex="0"`
- Explicit button: `aria-busy="true"` during loading
- Errors: `role="alert"`
- Focus management: On page load, focus the explicit button (not the hint input, to avoid premature autofill triggering on some browsers)

### Responsive Behavior

Same as `/register`. Card centered, max-width 448px, background gradient matching existing pattern.

---

## 4. Flow 3 — Add Email Connection (`/setup`, post-login)

### User Goal

Connect a first (or additional) email account after being authenticated. This is a required step for new users — they cannot use Kurir without at least one email connection.

### Context

- **New users** land here immediately after registration (redirected from `/register`).
- **Existing users** reach this via Settings > "Add email account".
- The existing `/setup` page is repurposed for this flow — it already has the IMAP/SMTP form logic.

### Happy Path

```
1. Authenticated user on /setup
2. Sees "Connect your email" card
3. Enters email address → provider auto-detected → IMAP/SMTP fields pre-filled
4. Enters email password or app password
5. Clicks "Connect account"
6. Server verifies IMAP connection
7. Success → if first connection, redirect to /imbox; if adding extra, redirect to /settings
```

### Decision Points

```
[Authenticated user on /setup]
     |
     v
[Is this user's first email connection?]
  YES → show "Connect your first email account" heading, skip link to /settings
  NO  → show "Add another email account" heading, show link back to /settings
     |
     v
[Enter email → detect provider]
     |
     +--> [Known provider (Gmail, Outlook, iCloud, Yahoo)] → auto-fill IMAP/SMTP
     |
     +--> [Unknown domain] → show advanced settings, require manual entry
     |
     v
[Submit → IMAP verify]
     |
     +--> [Success → first connection?]
     |       YES → /imbox
     |       NO  → /settings
     |
     +--> [IMAP auth failure] → "Couldn't connect. Check your password. Gmail and Outlook may require an app password."
     |
     +--> [IMAP host unreachable] → "Couldn't reach the mail server. Check the server settings."
     |
     +--> [Duplicate email (already connected)] → "This email is already connected to your account."
```

### Wireframe — `/setup`

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              [Kurir logo / Mail icon]               │
│                                                     │
│           Connect your email account                │
│     Link an email account to start using Kurir      │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │  [error message — hidden by default]          │  │
│  │                                               │  │
│  │  Email address                                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ [mail icon]  you@example.com            │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  Password                                     │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ [lock icon]  Email password or app...   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  For Gmail/Outlook, use an app password  [?]  │  │
│  │                                               │  │
│  │  Provider                                     │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  Gmail                             [v]  │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  [server icon]  Advanced settings        [v]  │  │
│  │  (expands to IMAP/SMTP host + port fields)    │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  [mail icon]  Connect account           │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│     [For extra connections only:]                   │
│     Cancel  ←  Back to settings                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Interaction Spec

- **New user context:** No "Back to settings" link. No "Already connected? Sign in" link (they are signed in).
- **Extra connection context:** Show "Back to settings" link. Heading changes to "Add another email account".
- **Provider auto-detect:** Fires on email blur (not on every keystroke). Sets provider dropdown value silently.
- **Advanced settings:** Collapsed by default for known providers. Auto-expands for unknown domains.
- **Loading state:** Button shows spinner + "Connecting..." while IMAP verify runs (can take 3–10 seconds).
- **Display name field (new addition vs. current setup page):** Optional field above email, e.g. "Work email" or "Personal". Helps distinguish connections in compose from-picker and settings.

### Accessibility

- Provider `<select>` has `aria-label="Email provider"`
- Advanced settings toggle is a `<button type="button">` with `aria-expanded` attribute
- IMAP/SMTP fields have descriptive labels ("IMAP host", "IMAP port", "SMTP host", "SMTP port")
- Error messages use `role="alert"`
- Loading button: `aria-busy="true"`, `aria-label="Connecting your email account, please wait"`

### Responsive Behavior

- Same pattern as existing `/setup` page — card centered, max-width 448px.
- Advanced settings grid: 2-column (host/port) on all screen sizes (already implemented in current code).

---

## 5. Flow 4 — Compose From-Picker

### User Goal

When composing a new email, select which connected email address to send from.

### Context

The current compose page sends from the single user email with no choice. With multiple connections, the user must be able to pick. The from-picker should default intelligently and never be a friction point for single-connection users.

### Behavior

- **Single connection:** No from-picker shown. Send from the only connection silently.
- **Multiple connections:** Show a "From" row above "To", with a dropdown/select.
- **Default selection:** The connection marked `isDefault = true` in the database.
- **Reply context:** When replying, auto-select the connection that received the original message (the `emailConnectionId` on the Message). The from-picker is still shown but pre-selected correctly.

### Wireframe — Compose with From-Picker

```
┌─────────────────────────────────────────────────────┐
│  New Message                     [Cancel]  [Send]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ From                                        │    │
│  │  ┌───────────────────────────────────────┐  │    │
│  │  │  me@gmail.com (Work)             [v]  │  │    │
│  │  └───────────────────────────────────────┘  │    │
│  │   Dropdown options:                         │    │
│  │   ● me@gmail.com (Work)  [default]          │    │
│  │   ○ me@icloud.com (Personal)                │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ To                                          │    │
│  │  ┌───────────────────────────────────────┐  │    │
│  │  │  Start typing a name or email...      │  │    │
│  │  └───────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Subject                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │  What's this about?                         │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Message                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │  Write your message...                      │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Interaction Spec

- **From field:** A native `<select>` wrapping connection options. Use the connection's `displayName` if set, otherwise show the email address only.
- **Option format:** `{displayName} — {email}` if display name set; `{email}` if not.
- **Default badge:** Show "(default)" next to the default connection in the dropdown.
- **No from-picker for single connection:** The `from` field is simply absent. The connection ID is sent implicitly.
- **Reply auto-selection:** Pass `fromConnectionId` as a URL param or prop to pre-select the correct connection.

### API Change

The send payload adds `fromConnectionId`:

```json
{
  "to": "recipient@example.com",
  "subject": "...",
  "text": "...",
  "fromConnectionId": "conn_abc123"
}
```

### Accessibility

- From `<select>` has `id="from"` and `<Label htmlFor="from">From</Label>`
- Screen reader reads: "From [selected email address]"
- Keyboard: standard `<select>` keyboard nav (arrow keys, space)

### Responsive Behavior

- From-picker is full-width, same as To/Subject fields.
- On mobile, the native `<select>` opens the platform's native picker — no need for a custom dropdown.

---

## 6. Flow 5 — Settings: Connection Management

### User Goal

View all connected email accounts, add new ones, and remove existing ones. Understand which is the default sending address.

### Wireframe — `/settings` (updated)

```
┌─────────────────────────────────────────────────────┐
│  Settings                                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Account                                            │
│  ┌───────────────────────────────────────────────┐  │
│  │  Display name    Your Name                    │  │
│  │  Account created  Jan 1, 2026                 │  │
│  │                                               │  │
│  │  Security                                     │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  Passkeys (1)                  [Manage] │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Email Connections                                  │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  me@gmail.com                           │  │  │
│  │  │  Work  ·  IMAP: imap.gmail.com  [default]│ │  │
│  │  │                          [···]  [Remove] │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  me@icloud.com                          │  │  │
│  │  │  Personal  ·  IMAP: imap.mail.me.com    │  │  │
│  │  │                          [···]  [Remove] │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  + Add email account                    │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Statistics                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  1,234   │  │   456    │  │   12     │          │
│  │ Messages │  │  Senders │  │ Pending  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                     │
│  Import                                             │
│  [...]                                              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Interaction Spec

**Connection cards:**

- Display: email address (primary), display name + IMAP host (secondary), "[default]" badge if `isDefault`.
- Actions: overflow menu `[···]` with options: "Set as default", "Edit", "Remove".
- "Remove" in overflow menu (not a standalone button in the card) to avoid accidental deletion.
- Removing the last connection: show a warning modal: "Removing this account will disconnect your only email. Add another email first, or remove your Kurir account."
- Setting a default: `PATCH /api/connections/[id]` sets `isDefault: true` (server ensures only one default at a time).

**"Add email account" button:**

- Ghost/outline style button at the bottom of the list.
- Links to `/setup` (with a query param like `?mode=add` so setup page knows this is an additional connection, not first-time setup).

**Passkeys section:**

- Shows count of registered passkeys.
- "Manage" button expands a list of passkeys with friendly names (e.g. "MacBook Pro", "iPhone") and "Remove" action.
- Minimum 1 passkey enforced: show "You must keep at least one passkey" if user tries to remove the last one.

### Remove Connection Confirmation

```
┌─────────────────────────────────────────┐
│  Remove me@gmail.com?                   │
│                                         │
│  This will remove the email connection  │
│  from Kurir. Your messages and sender   │
│  decisions will be deleted.             │
│                                         │
│  This cannot be undone.                 │
│                                         │
│       [Cancel]  [Remove account]        │
└─────────────────────────────────────────┘
```

### Accessibility

- Connection cards are `<article>` elements with `aria-label="Email connection: me@gmail.com"`
- Overflow menu button: `aria-label="More options for me@gmail.com"`, `aria-expanded` when open
- Remove confirmation is a modal dialog: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to dialog heading
- Focus trap inside modal
- "Add email account" button: `aria-label="Add another email account"`

### Responsive Behavior

- **Mobile:** Connection cards stack vertically, full width. Actions are in overflow menu to save space.
- **Tablet/Desktop:** Same layout, cards have subtle hover state.

---

## 7. Edge Cases and Error States

### Registration

| Scenario                             | UI Response                                                              |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Passkey already exists for device    | "A passkey for this device already exists. Sign in instead."             |
| WebAuthn not supported (old browser) | "Your browser doesn't support passkeys. Try Chrome, Safari, or Firefox." |
| Network error during registration    | "Registration failed. Check your connection and try again."              |
| Display name too long (>100 chars)   | Inline validation: "Name must be 100 characters or fewer."               |

### Login

| Scenario                         | UI Response                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| No passkey on device             | "No passkey found on this device. Did you register on a different device?"  |
| Counter mismatch (replay attack) | Generic: "Sign-in failed. Please try again." (don't reveal security detail) |
| No account found for passkey     | "Account not found. Please register."                                       |

### Add Email Connection

| Scenario                                | UI Response                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Wrong password                          | "Couldn't connect. Check your password. Gmail and Outlook may require an app password." |
| IMAP host unreachable                   | "Couldn't reach the mail server. Check the IMAP host and port."                         |
| Email already connected to this account | "This email is already connected to your account."                                      |
| Connection timeout (>15 seconds)        | "Connection timed out. The server may be slow or the port may be blocked."              |

### Settings — Remove Connection

| Scenario                 | UI Response                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| Removing last connection | Block action + warning: "Add another email before removing this one." |
| Network error on remove  | Toast: "Failed to remove account. Please try again."                  |

### Compose

| Scenario                                      | UI Response                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| All connections removed while compose is open | Show error banner in compose: "No email accounts connected. Add one in Settings." |
| Send fails (SMTP error)                       | Existing error display: `{error.message}`                                         |

---

## 8. Empty States

### Settings — No Connections (Should Not Happen in Practice)

```
┌────────────────────────────────────────┐
│                                        │
│          [mail icon — muted]           │
│                                        │
│       No email accounts connected      │
│   Add an email account to start using  │
│               Kurir.                   │
│                                        │
│     [ + Add email account ]            │
│                                        │
└────────────────────────────────────────┘
```

---

## 9. Navigation and Route Changes

| Route       | Before                                       | After                                             |
| ----------- | -------------------------------------------- | ------------------------------------------------- |
| `/register` | Does not exist                               | New passkey registration page                     |
| `/login`    | Email + password form                        | Passkey login (conditional UI + explicit button)  |
| `/setup`    | Email + password + IMAP = register AND login | IMAP/SMTP connection for authenticated users only |
| `/settings` | Single account info                          | Multi-connection list + passkey management        |
| `/compose`  | No from-picker                               | From-picker (if >1 connection)                    |

### Middleware

- `/register` must be added to the public (unprotected) routes list alongside `/login` and `/setup`.
- `/setup` should remain public for the new-user first-connection flow (user has a session but may not yet have a connection).

---

## 10. Coordination Notes for Graphic Designer

Visual design handoff items:

1. **Passkey icon / fingerprint icon** — needs a consistent icon across register, login, and settings pages. Suggest `KeyRound` or `Fingerprint` from lucide-react.
2. **Connection card component** — new card design for each email connection in settings. Should show email address prominently, secondary metadata (display name, IMAP host) in muted text, and actions in an overflow menu.
3. **"Default" badge** — subtle, e.g. a muted outline pill with text "default". Not too prominent.
4. **From-picker in compose** — styled to match existing form fields. Use the existing `<select>` pattern or consider a custom `Combobox` if brand polish warrants it.
5. **Modal/dialog for remove confirmation** — matches existing destructive action patterns (red "Remove account" button, ghost "Cancel").
6. **Loading states** — passkey button loading uses `Loader2 animate-spin` (matches existing pattern in login/setup pages).

---

## 11. Open Questions

1. **Passkey management page:** Should we build a dedicated `/settings/passkeys` sub-page, or is an expandable section within `/settings` sufficient? Given this is a personal project with likely 1–3 passkeys, the expandable section is probably enough.

2. **First-run redirect:** After registration, should the user be sent to `/setup` (to add email) or shown an in-page step (multi-step wizard)? Recommendation: separate `/setup` page redirect is simpler and consistent with existing patterns.

3. **Display name for connections:** Should the display name field in `/setup` be required or optional? Recommendation: optional, defaulting to the email address as the label in the from-picker.

4. **Syncing status per connection:** Should settings show per-connection sync status (last synced, message count)? Out of scope for this redesign but worth tracking as a follow-up.
