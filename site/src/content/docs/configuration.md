---
title: Configuration
description: Complete reference for all Kurir environment variables, grouped by category.
order: 3
---

# Configuration

Kurir is configured through environment variables in a `.env` file. If you used the one-command installer, this file lives at `/opt/kurir/.env` and secrets were generated automatically. For manual setups, copy `.env.production.example` and fill in the values.

All secrets can be generated with:

```bash
openssl rand -base64 32
```

## Domain

| Variable     | Required        | Description                                                                                                            |
| ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`     | Yes             | Your server's public domain name (e.g. `mail.example.com`). Caddy uses this to auto-provision HTTPS via Let's Encrypt. |
| `ACME_EMAIL` | Yes (installer) | Email address for Let's Encrypt certificate notifications. Set automatically by the installer.                         |

## Database

| Variable            | Required | Default | Description                                                                    |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | Yes      | --      | Password for the PostgreSQL database. Generate with `openssl rand -base64 32`. |
| `POSTGRES_USER`     | No       | `kurir` | PostgreSQL username.                                                           |
| `POSTGRES_DB`       | No       | `kurir` | PostgreSQL database name.                                                      |

The app connects using a `DATABASE_URL` constructed from these values internally:

```
postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?connection_limit=10
```

## Redis

| Variable         | Required | Description                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `REDIS_PASSWORD` | Yes      | Password for the Redis instance. Generate with `openssl rand -base64 32`. |

Redis is configured with a 256 MB memory limit and `allkeys-lru` eviction policy. It stores BullMQ job queues and application cache data.

## Application Secrets

| Variable          | Required | Description                                                                                                                                                                |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXTAUTH_SECRET` | Yes      | Secret key for signing NextAuth.js session tokens. Generate with `openssl rand -base64 32`.                                                                                |
| `ENCRYPTION_KEY`  | Yes      | AES-256-GCM key for encrypting stored email passwords. Generate with `openssl rand -base64 32`. Without this key, encrypted passwords in the database cannot be decrypted. |

## WebAuthn (optional)

Passkey / WebAuthn support for passwordless login.

| Variable           | Required | Default           | Description                                                                                       |
| ------------------ | -------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `WEBAUTHN_RP_NAME` | No       | `Kurir`           | Display name shown during passkey registration prompts.                                           |
| `WEBAUTHN_RP_ID`   | No       | Value of `DOMAIN` | The relying party identifier. Automatically derived from your domain in the Docker Compose setup. |

## Push Notifications (optional)

Web push notifications require VAPID (Voluntary Application Server Identification) keys. The one-command installer generates these automatically using OpenSSL.

| Variable                       | Required | Description                                                                       |
| ------------------------------ | -------- | --------------------------------------------------------------------------------- |
| `VAPID_PRIVATE_KEY`            | No       | VAPID private key (URL-safe base64).                                              |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No       | VAPID public key (URL-safe base64). Exposed to the browser for push subscription. |

To generate VAPID keys manually:

```bash
npx web-push generate-vapid-keys
```

If these variables are omitted, push notification features are disabled.

## OAuth Providers (optional)

OAuth enables "Sign in with Google" and "Sign in with Microsoft" buttons for connecting email accounts without app passwords. When the corresponding environment variables are not set, the OAuth buttons simply do not appear in the UI.

### Microsoft (Azure AD / Entra)

| Variable                  | Required | Description                                               |
| ------------------------- | -------- | --------------------------------------------------------- |
| `MICROSOFT_CLIENT_ID`     | No       | Application (client) ID from your Azure App Registration. |
| `MICROSOFT_CLIENT_SECRET` | No       | Client secret value from Certificates & secrets.          |

See [Email Accounts](email-accounts) for the full Azure setup walkthrough.

### Google

| Variable               | Required | Description                                    |
| ---------------------- | -------- | ---------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | No       | OAuth 2.0 Client ID from Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | No       | OAuth 2.0 Client Secret.                       |

See [Email Accounts](email-accounts) for the full Google OAuth setup walkthrough.

## Example configuration

Here is a minimal `.env` for a production deployment:

```bash
DOMAIN=mail.example.com

POSTGRES_PASSWORD=<generated>
REDIS_PASSWORD=<generated>

NEXTAUTH_SECRET=<generated>
ENCRYPTION_KEY=<generated>
```

And a more complete one with all optional features enabled:

```bash
DOMAIN=mail.example.com
ACME_EMAIL=admin@example.com

POSTGRES_PASSWORD=<generated>
REDIS_PASSWORD=<generated>

NEXTAUTH_SECRET=<generated>
ENCRYPTION_KEY=<generated>

WEBAUTHN_RP_NAME=Kurir

VAPID_PRIVATE_KEY=<generated>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<generated>

MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=<secret>

GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<secret>
```
