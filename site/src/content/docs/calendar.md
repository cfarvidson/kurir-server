---
title: Calendar
description: Connect Google, Outlook, CalDAV or calendar URLs, answer invitations from mail, and set the hours you are available.
order: 7
---

# Calendar

Kurir has a calendar next to your mail. It shows the calendars you already have with Google, Outlook, iCloud or any CalDAV server, and invitations you get by mail can be answered straight from the message. The calendar works the same in the web app and in the iPhone and Mac apps.

## Connect a calendar

Open **Settings → Calendar accounts** and pick one:

- **Add Google** - signs in with Google. Needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server, the same values used for Gmail sign-in (see [Email Accounts](/docs/email-accounts)).
- **Add Outlook** - signs in with Microsoft. Needs `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`, the same values used for Outlook sign-in.
- **Add CalDAV** - enter the server **URL**, **Username** and **Password**. Use this for iCloud, Fastmail, Nextcloud or any other CalDAV server. iCloud and Fastmail need an app-specific password, like for mail.
- **Add calendar URL** - subscribe to a public calendar feed (`https://`, `webcal://` or `webcals://`). These calendars are read-only.

The password for a CalDAV account is stored encrypted on your server. **Disconnect** removes an account, and **Reconnect** fixes one whose sign-in has expired.

## What syncs

Kurir checks each calendar account every two minutes, and you can sync a calendar on demand from Settings. Events, recurring events, attendees and free/busy status sync both ways for Google, Outlook and CalDAV. Tasks (VTODO) are not synced. Reminders stay with your calendar provider; Kurir does not send its own.

## Views

The calendar has three views: **Week**, **Day** and **Month**.

- **Week** is an hour grid. Drag in the grid to create an event.
- **Day** shows one day at a time with room for detail.
- **Month** gives the overview, with today highlighted.

Click an event to edit or delete it. For a recurring event you choose whether the change applies to this event, this and the following ones, or the whole series.

In Week and Day, today's open stretches between your events are marked, for example "+ 1 h open". Click one to create an event in that slot.

## Available time

**Settings → Available time** sets the hours you are available on each weekday, in 30-minute steps. Turn a day off to mark it **Not available**. The default is 07:00-21:00 every day.

Open time is only counted inside these hours, and hours outside them are shaded in Week and Day.

## Invitations in mail

When a mail contains a calendar invitation, the message shows a meeting card with **Accept**, **Maybe** and **Decline**, and a **Show in calendar** link. Your answer is sent to the organizer and saved to your calendar. You need a connected calendar you can write to for the buttons to appear.

## Next up

The Mail panel in the sidebar shows a **Next up** card with your next timed event today. It shows "Now" when the event has started, or "in X min" when it starts within the hour. All-day events are not shown there.

## Claude and other agents

The [MCP server](/docs/mcp) lets Claude read your calendar, book events and answer invitations. Anything that changes the calendar asks you to confirm first.
