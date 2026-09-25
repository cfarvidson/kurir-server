---
title: Claude & MCP
description: Connect Claude or another MCP client to your Kurir server to read mail, triage, and work with your calendar and contacts.
order: 10
---

# Claude & MCP

Your Kurir server has a built-in [MCP](https://modelcontextprotocol.io) server at `https://<your-domain>/mcp`. Connect Claude (or another MCP client) to it and the agent can read and search your mail, triage, screen senders, work with contacts and your calendar, and change your own settings. Anything that sends mail, deletes something or answers an invitation asks you to confirm in Claude first.

## Connect Claude

1. In Claude, add a custom connector with the URL `https://<your-domain>/mcp`.
2. Claude opens your Kurir sign-in page. Sign in with your passkey.
3. Approve the access Claude asks for.

Claude identifies itself with a Client ID Metadata Document, so there is nothing to register on the server. PKCE is required, and there is no client secret.

To stop access, open **Settings → Connected apps** in Kurir and revoke the app.

### Clients that cannot publish a Client ID Metadata Document

An admin can register the client by hand under **Admin → Apps**, with its redirect URI. Kurir generates a `client_id` to hand over to the client. PKCE is still required.

## What the agent can do

| Area           | Tools                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mail           | `list_mail`, `get_thread`, `search_mail`, `get_counts`, `get_attachment`, `upload_attachment`, `sync_mail`, `get_sync_status`, `update_thread`                          |
| Drafts & sending | `save_draft`, `delete_draft`, `send_mail`, `schedule_mail`, `update_scheduled`, `cancel_scheduled`, `send_scheduled_now`                                             |
| Screener       | `screen_sender`, `update_sender`, `list_domain_rules`, `create_domain_rule`, `update_domain_rule`, `delete_domain_rule`                                                 |
| Contacts       | `list_contacts`, `get_contact`, `search_contacts`, `create_contact`, `update_contact`, `delete_contact`, and contact groups (`list_contact_groups`, `create_contact_group`, `update_contact_group`, `delete_contact_group`, `add_group_member`, `remove_group_member`) |
| Calendar       | `list_calendars`, `list_events`, `get_event`, `create_event`, `delete_event`, `respond_to_event`                                                                         |
| Settings       | `get_settings`, `update_settings`, `list_connections`, `update_connection`, `delete_connection`, `list_passkeys`, `revoke_passkey`, `bulk_approve_old_senders`          |

### Confirmations

These tools do nothing until you confirm the exact action in Claude: `send_mail`, `schedule_mail`, `send_scheduled_now`, `screen_sender`, `create_domain_rule`, `delete_contact`, `delete_contact_group`, `create_event`, `delete_event`, `respond_to_event`, `delete_connection`, `revoke_passkey` and `bulk_approve_old_senders`. A confirmation is tied to the exact arguments, can be used once, and expires after 10 minutes.

### Calendar tools

Event times are given as a wall-clock time in your account's time zone (no offset) or as an exact instant with an offset or `Z`. All-day events use dates (`YYYY-MM-DD`). `list_events` covers at most 31 days per call.

## Notes

- The agent only ever reaches your own account. Every tool runs as the user who signed in.
- On the public demo instance, calendar changes are turned off.
- The MCP server needs no extra configuration beyond a normal HTTPS install.
