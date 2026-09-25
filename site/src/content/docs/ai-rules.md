---
title: AI Rules
description: File mail from a sender by what it says, with a rule written in plain language and checked by your Claude or Grok subscription.
order: 8
---

# AI Rules

Screening decides where a sender's mail goes. An AI rule goes one step further and looks at what each mail says. You write the criterion in plain language, for example *"Profiles for an assignment with two remote days a week, on-site in Uppsala or Stockholm"*, and Kurir asks a model whether each new mail from the sender matches. Depending on the answer, the mail is filed in the Imbox, The Feed or Paper Trail, archived, or left where it is.

## Requirements

AI rules run on the same credential as [Draft Generation](draft-generation): a Claude Pro/Max token from Claude Code, or a SuperGrok session from Grok Build, connected in **Settings → Draft generation**. You can write rules without one, but the AI Rules page then shows **No model connected** and nothing is checked until you connect a token.

> **Privacy note:** each mail a rule checks (sender, subject, date and up to 16,000 characters of the text) is sent to Anthropic or xAI to get the verdict. Only mail from the senders a rule covers is sent.

## Create a rule

Open **AI Rules** in the sidebar (under Screener), or click **AI rule** on a mail row or in the header of an open mail. Starting from a mail fills in the sender for you.

1. Under **What should the model look for?**, write the criterion. Up to 2000 characters.
2. Choose which mail it covers under **Sender scope**: an **Address**, a **Domain**, or a **Domain and subdomains**, and under **Mail from** one of your email accounts or **All inboxes**.
3. Pick what happens **When it matches** and **When it does not match**:
   - **Leave where the sender's rule put it**
   - **File in Imbox**
   - **File in The Feed**
   - **File in Paper Trail**
   - **Block (archive)**
4. Under **Apply to**, choose **Only new mail from now on** or **Also mail from the last 30 days**.
5. Click **Create rule**.

A rule can cover more than one sender. Add or remove senders, and edit the criterion, from **Your rules**.

## What you see

- **List rows** carry a small badge with the outcome, for example "Matched · filed in Feed".
- **The open mail** shows a one-line filing log, "AI filed this in The Feed", with the model's reason, when a rule moved it.
- **The person pane** shows the newest verdict for that sender, with the reason.
- **Matched mail** on the AI Rules page lists the mail each rule has judged.

Push notifications for mail a rule covers wait until the verdict is in, so you are not notified about mail that is about to be filed away.

## Check again

- **Re-check last 30 days** on a rule runs it again over the sender's mail from the last 30 days, for example after you change the wording.
- **Check now** at the top of **Your rules** checks mail that has not been judged yet. It runs in the background; reload the page after a moment to see new matches.

When you edit a rule's criterion, tick **Check mail this rule has already judged again** to judge existing mail with the new wording. Otherwise the new wording applies to new mail only.

## Where it works

Rules run on the server, so they apply no matter which device is open. The iPhone and Mac apps show the same verdicts and have the same AI Rules screen.
