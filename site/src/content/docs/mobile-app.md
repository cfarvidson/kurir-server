---
title: Mobile App
description: Install Kurir as a Progressive Web App on iOS and Android for an app-like experience with push notifications.
order: 5
---

# Mobile App

Kurir is a Progressive Web App (PWA), which means you can install it on your phone's home screen and use it like a native app — no App Store, no TestFlight, no extra account. It works on iOS 16.4+ and any modern Android device.

When installed, Kurir runs full-screen without browser chrome, supports push notifications, and survives reboots like a native app would.

## Requirements

- Your Kurir server must be reachable over **HTTPS** with a real (browser-trusted) certificate. The one-command installer handles this automatically with Let's Encrypt. If you self-signed, the install won't work.
- **iOS 16.4 or later** for push notifications. Earlier versions can install the PWA but won't deliver pushes.
- **Web Push enabled** on the server. The installer generates VAPID keys automatically; if you skipped that step, see the [Configuration](configuration) docs to add them.

## Install on iPhone or iPad

1. Open **Safari** on your phone (it must be Safari — Chrome and Firefox on iOS use WebKit but can't install PWAs).
2. Go to your Kurir URL (e.g. `https://mail.example.com`).
3. Sign in and complete any first-run setup.
4. Tap the **Share** button (the square with the up arrow) at the bottom of the screen.
5. Scroll down in the share sheet and tap **Add to Home Screen**.
6. You'll see a preview with the Kurir icon and name. Tap **Add** in the top right.
7. The Kurir icon now appears on your home screen. Tap it to launch — it opens full-screen, no browser bar.

### Enable push notifications (iOS 16.4+)

After installing to the home screen, open Kurir from the home screen icon (not Safari). Then:

1. Go to **Settings** inside Kurir
2. Find the **Notifications** section
3. Tap **Enable push notifications**
4. iOS will prompt you for permission — tap **Allow**

You'll now get a push when new mail arrives in your Imbox.

> **Note:** iOS only allows PWAs to request push permission when launched from the home screen. If you try from inside Safari, the option won't appear.

## Install on Android

1. Open **Chrome** (or any Chromium-based browser) on your Android device.
2. Go to your Kurir URL.
3. Sign in and complete any first-run setup.
4. Chrome should show an **Install app** banner near the top or in the menu. If not:
   - Tap the three-dot menu in the top right
   - Tap **Install app** or **Add to Home Screen**
5. Confirm by tapping **Install**.
6. Kurir is now in your app drawer and on your home screen.

### Enable push notifications (Android)

Push works out of the box on Android. After installing:

1. Open Kurir from your home screen
2. Go to **Settings → Notifications**
3. Tap **Enable push notifications**
4. Allow when prompted

## Updating the installed app

Kurir auto-updates when the server is updated — there's nothing to install on your phone. The PWA fetches the latest assets from your server on each launch (or in the background via the service worker).

If you're seeing stale UI after a server update, force a refresh:

- **iOS:** Close the Kurir tab in the App Switcher, then reopen it from the home screen
- **Android:** Long-press the Kurir icon, tap **App info → Storage → Clear cache**, then relaunch

## Uninstall

- **iOS:** Long-press the Kurir icon → **Remove App** → **Delete from Home Screen**
- **Android:** Long-press the Kurir icon → **Uninstall**

## Troubleshooting

**The "Add to Home Screen" option is missing on iOS**
You need to be in Safari, not Chrome or Firefox. Also make sure you're on the actual page (not a "Cannot connect" error page).

**Push notifications option is greyed out on iOS**
You're running the app from inside Safari, not from the home screen icon. Close it, open it from the home screen, and try again.

**"Enable push notifications" gives an error**
Your server is missing VAPID keys. SSH in and check `/opt/kurir/.env` for `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Re-run the installer to generate them, then `docker compose restart app`.

**Pushes work for a few hours then stop**
Apple's push relay can drop subscriptions if the device is offline for a while. Open Kurir from the home screen and the subscription will renew on launch.

**The app shows a blank screen on iOS**
Usually a stale service worker. Delete the home screen icon, reopen the URL in Safari, and add to home screen again.
