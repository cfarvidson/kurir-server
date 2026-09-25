---
title: Using Kurir
description: The sidebar, screening, the Later lists, pins, private notes, search, attachments and keyboard shortcuts.
order: 6
---

# Using Kurir

This page covers the everyday parts of Kurir in the web app. The iPhone and Mac apps have the same features in the same places, adapted to each platform.

## The sidebar

On a wide screen the sidebar is an icon rail with a panel beside it. The rail has five sections:

- **Mail** - the panel lists **Imbox**, **The Feed**, **Paper Trail** and **Pinned**, then **Later** (Snoozed, Reply Later, Follow Up), then **Outbound** (Drafts, Scheduled, Sent), then **Archive**.
- **Screener** - the Screener and [AI Rules](/docs/ai-rules).
- **Calendar** - see [Calendar](/docs/calendar).
- **Contacts**
- **Files** - every attachment you have received, searchable by file name and sender.

The bottom of the rail holds the command palette (`Cmd+K`), the keyboard shortcuts (`?`), Settings and Sign out.

The Mail panel opens with a **Next up** card showing your next timed event today, with "Now" or "in X min" when it is less than an hour away. All-day events are left out.

Badges show unread counts on Imbox, The Feed, Paper Trail and the Screener, and counts on Reply Later, Follow Up and Scheduled.

On a phone the web app uses a tab bar instead of the rail.

## Screening senders

Mail from someone you have never heard from lands in the **Screener**. Screen them in (`y`) and pick where their mail goes: the Imbox, The Feed or Paper Trail. Screen them out (`n`) and you do not see their mail again.

When you write to someone, Kurir screens them in for you, so their reply lands in the Imbox instead of the Screener. This covers To and Cc recipients, not Bcc.

Settings also has a button that approves pending senders whose latest message is older than 90 days, so you only screen recent senders by hand.

## Later: Snooze, Reply Later and Follow Up

- **Snooze** (`s`) hides a thread until a time you pick: Later today (three hours from now), Tomorrow, the two following weekdays by name, This weekend, Next week, or Pick a date. Snoozed threads wait under **Snoozed** and come back on their own.
- **Reply Later** marks a thread you owe an answer. Use the **Reply later** button in the thread header; it works on archived threads too. The **Reply Later** list shows everything you have marked.
- **Follow Up** (`f`) reminds you about mail you are waiting on.

## Pinned

Pin a thread (`p`, or **Pin** on a list row or in the open thread) to keep it in the **Pinned** list, whether it is in a list or in the archive. Pin again to unpin. Pins are stored as the flagged state on your mail server, so they also show as flagged in other mail apps.

## Private notes on a thread

In an open thread, click **Add a private note** next to the subject. Notes are up to 1000 characters, save automatically, are never sent with replies, and sync to your iPhone and Mac.

## Search

Press `/` to search. Kurir searches subjects, message text, sender names and addresses, and recipient addresses. Every word you type is matched as the start of a word, so `invo` finds "invoice", and words are not stemmed, so Swedish and other non-English words match as written.

Filter chips narrow the result: **From** (a name or address), **Domain**, **Date**, and **Has attachment**. A From chip works on its own, without any search text. When you search from Imbox, The Feed or Paper Trail you can switch between **All mail** and that list.

## Writing mail

- Mail is written in Markdown, and drafts save automatically.
- **Send again** on a message you sent opens a new mail with the same subject, text and attachments and empty recipients.
- Click a person's name in a thread to see their card, where you can select or copy their email address.
- [Draft Generation](/docs/draft-generation) can write drafts for you.

### Attachments

Each file can be up to 10 MB and each mail up to 25 MB in total. If a picked image would push you over a limit, Kurir shrinks it in the browser so it fits, keeping as much quality as the limit allows. JPEG, PNG, WebP and AVIF images can be shrunk; other files that do not fit are rejected with a message. Files that already fit are never touched.

## Keyboard shortcuts

Press `?` in Kurir to see them all. The most used ones:

| Keys              | Action                        |
| ----------------- | ----------------------------- |
| `j` / `k`         | Next / previous conversation  |
| `Enter`           | Open conversation             |
| `Esc`             | Back to the list              |
| `e`               | Archive                       |
| `s`               | Snooze                        |
| `f`               | Follow up                     |
| `p`               | Pin / unpin                   |
| `x`               | Select / deselect             |
| `Shift+U`         | Toggle read / unread          |
| `/`               | Search                        |
| `c`               | Compose                       |
| `r` / `a`         | Reply / reply all             |
| `Cmd+Enter`       | Send                          |
| `y` / `n`         | Screen in / screen out        |
| `1` / `2` / `3`   | In the Screener: send to Imbox / Feed / Paper Trail |
| `Cmd+K`           | Command palette               |
| `Cmd+R`           | Sync                          |

Go-to shortcuts are two keys in a row: `g i` Imbox, `g f` The Feed, `g p` Paper Trail, `g n` Screener, `g e` Calendar, `g a` Archive, `g s` Sent, `g u` Follow Up, `g r` Reply Later, `g z` Snoozed, `g d` Scheduled, `g l` Files, `g c` Contacts.
