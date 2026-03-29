---
title: Email Accounts
description: How to connect Gmail, Outlook, iCloud, Yahoo, or any IMAP/SMTP email provider to Kurir.
order: 4
---

# Email Accounts

Kurir supports any email provider with IMAP and SMTP access. You can connect accounts using app passwords (works with all providers) or OAuth (available for Microsoft and Google when configured).

## Supported providers

| Provider                | IMAP Host                 | SMTP Host                 | Auth Method                                                                |
| ----------------------- | ------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| Gmail                   | `imap.gmail.com`          | `smtp.gmail.com`          | OAuth or [App Password](https://support.google.com/accounts/answer/185833) |
| Outlook / Microsoft 365 | `outlook.office365.com`   | `smtp.office365.com`      | OAuth (recommended) or App Password                                        |
| iCloud                  | `imap.mail.me.com`        | `smtp.mail.me.com`        | [App Password](https://support.apple.com/en-us/102654) required            |
| Yahoo                   | `imap.mail.yahoo.com`     | `smtp.mail.yahoo.com`     | App Password required                                                      |
| Custom                  | Your provider's IMAP host | Your provider's SMTP host | Password or App Password                                                   |

## App passwords vs OAuth

**App passwords** work with every provider and do not require any server-side configuration. You generate a one-time password in your email provider's security settings, and Kurir uses it to connect via IMAP/SMTP. This is the simplest option.

**OAuth** eliminates the need for app passwords by using token-based authentication. The user clicks "Sign in with Google" or "Sign in with Microsoft," authorizes access, and Kurir receives a token that it refreshes automatically. OAuth requires setting up an application registration with the provider (see below).

## Adding accounts via CLI

Use the `add-user` command to add email accounts from the terminal:

```bash
# Interactive mode -- prompts for all fields
pnpm add-user

# With arguments (for scripting)
pnpm add-user --email user@gmail.com --password "app-password" --provider gmail

# Custom IMAP/SMTP servers
pnpm add-user --email user@example.com --password "pass" \
  --imap-host imap.example.com --smtp-host smtp.example.com
```

To list existing users:

```bash
pnpm list-users
```

To trigger an email sync:

```bash
# Sync a specific user
pnpm sync-user user@gmail.com

# Sync all users
pnpm sync-user --all
```

## Adding accounts via the web UI

After logging in, go to **Settings** and use the "Add Email Account" form. Choose your provider from the dropdown (Gmail, Outlook, iCloud, Yahoo, or Custom) and either:

- Enter your email and app password, or
- Click the OAuth button (if available) to authorize directly

## OAuth setup: Microsoft (Azure AD / Entra)

OAuth lets users connect Outlook and Microsoft 365 accounts without app passwords. It requires a free Azure account.

> Requires a free Azure account which creates an Entra ID tenant. App registration is free forever -- the credit card is for identity verification only.

### Step-by-step

1. Create a free Azure account at [azure.microsoft.com/free](https://azure.microsoft.com/free).
2. Go to [entra.microsoft.com](https://entra.microsoft.com) > **Identity** > **Applications** > **App registrations** > **New registration**.
3. Name: e.g. "Kurir Mail".
4. Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"** (multi-tenant + personal).
5. Redirect URI (Web): `https://<your-domain>/api/auth/oauth/callback`
6. Click **Register**, then copy the **Application (client) ID** -- this is your `MICROSOFT_CLIENT_ID`.
7. Go to **Certificates & secrets** > **New client secret**, copy the value -- this is your `MICROSOFT_CLIENT_SECRET`.
8. Go to **API permissions** > **Add a permission** > **APIs my organization uses** > search for **"Office 365 Exchange Online"**.

> **"Office 365 Exchange Online" not showing up?** Free tenants don't have the Exchange service principal pre-provisioned. Go to your app's **Manifest** tab, find the `requiredResourceAccess` array, and add:
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

9. Select **Delegated permissions**, and add:
   - `IMAP.AccessAsUser.All`
   - `SMTP.Send`
10. Click **"Grant admin consent"** (you are tenant admin on a free account).

Set the two environment variables in your `.env`:

```bash
MICROSOFT_CLIENT_ID=your-azure-app-client-id
MICROSOFT_CLIENT_SECRET=your-azure-app-client-secret
```

## OAuth setup: Google

OAuth lets users connect Gmail accounts without app passwords.

### Step-by-step

1. Go to [Google Cloud Console](https://console.cloud.google.com) > **APIs & Credentials**.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add authorized redirect URI: `https://<your-domain>/api/auth/oauth/callback`
4. Enable the **Gmail API** in the API Library.
5. Copy the Client ID and Client Secret.

Set the two environment variables in your `.env`:

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

## How OAuth works in Kurir

Both Microsoft and Google OAuth use `NEXTAUTH_URL` as the base for the redirect URI. When a user authenticates via OAuth:

1. The user is redirected to the provider's consent screen.
2. After approval, the provider sends an authorization code back to Kurir.
3. Kurir exchanges the code for access and refresh tokens.
4. The access token is used for IMAP and SMTP connections.
5. Token refresh is handled automatically -- users do not need to re-authenticate.

OAuth buttons only appear in the UI when the corresponding `CLIENT_ID` and `CLIENT_SECRET` environment variables are set.
