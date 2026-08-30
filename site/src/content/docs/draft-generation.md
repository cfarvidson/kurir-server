---
title: Draft Generation
description: Let Kurir write reply drafts with your existing Claude Pro/Max or SuperGrok subscription - no API key, no per-token billing.
order: 6
---

# Draft Generation

Kurir can write email drafts for you - replies that pick up the tone and context of your earlier correspondence with the recipient, generated on your own server and dropped straight into the composer. It works in the web app, the iPhone app, and the Mac app, from one server-side setup.

The feature deliberately runs on **subscription credentials only**: a Claude Pro/Max seat (via Claude Code) or a SuperGrok seat (via Grok Build). Pay-per-token API keys (`sk-ant-api…`, `xai-…`) are rejected on paste, so connecting Kurir can never silently start a metered bill. You use the subscription you already pay for.

> **Privacy note:** when you tap Generate draft, the current thread plus a small sample of your earlier correspondence with that sender is sent to Anthropic or xAI to produce the draft. Nothing is sent until you tap the button, and nothing is sent in the background.

## Requirements

- Kurir server **v2026.44 or later**.
- A **Claude Pro or Max** subscription (for Claude Code) or a **SuperGrok** subscription (for Grok Build).
- The provider's CLI installed on your computer, one time, to mint the credential. The CLI is not needed afterwards.
- Not available on the public demo instance.

## Connect Claude Code

1. Install [Claude Code](https://code.claude.com) if you don't have it, and sign in with your Claude Pro/Max account.
2. In a terminal, run:

   ```bash
   claude setup-token
   ```

3. Approve the request in the browser window that opens, then copy the token it prints. It starts with `sk-ant-oat` - that prefix is how you know it's a subscription token and not an API key.
4. In Kurir, open **Settings → Draft generation** (web, iPhone, or Mac - they all write to the same server-side setting).
5. Pick **Claude Code** as the provider, paste the token, and save.

If you paste an Anthropic Console key (`sk-ant-api…`) by mistake, Kurir refuses it and tells you to run `claude setup-token` instead.

## Connect Grok Build

1. Install the [Grok CLI](https://docs.x.ai/) and sign in with your SuperGrok account:

   ```bash
   grok login
   ```

2. Open the file `~/.grok/auth.json` and copy its **entire contents** (it holds the access and refresh tokens).
3. In Kurir, open **Settings → Draft generation**, pick **Grok Build** as the provider, paste the JSON, and save.

Kurir refreshes the Grok session automatically when it expires, so this is a one-time paste. An `xai-…` API key is rejected the same way Console keys are.

## Writing drafts

Once connected, a **Generate draft** button (sparkles icon in the apps) appears in the composer - both when replying and when writing a new mail to someone. It opens the compose assistant.

- **Say what the mail should say.** A few sentences is enough: *"Say I can't make Tuesday, offer Thursday."* Leave it empty and Kurir infers from earlier mail with that person, exactly as before. On a new mail with no earlier correspondence, say what it should say - Kurir will not invent one.
- **Pick a tone.** Auto (matches the voice of your own earlier mail), Formal, Friendly, or Direct. The choice is remembered on that device.
- **Generate.** Kurir builds a context pack from the thread and your history with the recipient, and the model can additionally search and read your own mail when the draft depends on facts outside that thread - so *"the invoice thread from March"* gets its numbers right. That lookup is bounded, runs on your server, and can only ever reach your own mailbox.
- **Flip between versions.** Every round is kept while the composer is open (1/3, 2/3, …), so you can generate again and go back to the best one. Your instruction and tone are reused and stay editable between rounds.
- **Insert the one you want.** Nothing reaches the composer until you insert it, so generation never overwrites what you typed. For a new mail with an empty subject line, Kurir also proposes a subject; a subject you already typed is left alone.
- Generation runs server-side, so the assistant works identically on web, iPhone, and Mac. While it's running the button becomes a cancel button, and versions are gone when you close the composer - nothing is stored.

The result is a draft, not an outbox: read it, edit it, and send it yourself.

The compose assistant needs server **v2026.45 or later**. Against an older server the apps say "Update the server" rather than quietly dropping your instruction.

## Disconnect

**Settings → Draft generation → Disconnect** deletes the credential from the server and hides the button on every device. Kurir stores one credential per account, so saving a new token (or switching provider) replaces the old one.

## How the credential is stored

The token is encrypted at rest with your server's `ENCRYPTION_KEY` (AES-256-GCM), the same scheme Kurir uses for IMAP passwords. It never leaves the server, is never shown again after saving, and is excluded from [settings backups](backup-restore).

## Troubleshooting

**"That is an … API key, which bills per token"**
You pasted a pay-per-token key. Run `claude setup-token` (Claude) or copy `~/.grok/auth.json` (Grok) and paste that instead.

**The Generate draft button doesn't appear**
No credential is connected for your account, or the composer has no recipient yet. Check **Settings → Draft generation**.

**"Update the server" in the iPhone/Mac app**
The app is newer than your server. Update the server to v2026.44 or later.

**Token expired or revoked**
Setup-tokens can be revoked (for example from your Anthropic account) and Grok sessions can die. Kurir shows a clear error in the composer; reconnect with a fresh token in Settings.

**Usage limit reached**
Your subscription hit its quota with the provider. Wait for the window to reset - Kurir will work again on its own.

**Too many requests**
Draft generation is rate-limited to 10 requests per 10 minutes per user.
