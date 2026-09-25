---
title: Mobile & Mac Apps
description: Use Kurir on your phone and your Mac - the native iPhone and Mac apps from the App Store, or the free PWA on iOS and Android.
order: 5
---

# Mobile & Mac Apps

There are two ways to use Kurir outside the browser:

- **The native iPhone and Mac apps.** Written in Swift, offline-first and faster than the web app. They are paid apps on the [App Store](https://apps.apple.com/se/app/kurir-email/id6795541775?l=en-GB) and the [Mac App Store](https://apps.apple.com/se/app/kurir-email/id6795541775?l=en-GB&mt=12), and they are what funds the rest of the project.
- **The Progressive Web App (PWA).** Install the web app on your phone's home screen - no App Store, no extra account. It has every Kurir feature, works on iOS 16.4+ and any modern Android device, and is free like everything else you run on your own server.

You never have to buy the native apps. They talk to the same server as the web app, so your mail, screening decisions and settings are the same everywhere.

## Native iPhone and Mac apps

### Sign in

1. Install Kurir from the App Store (iPhone) or the Mac App Store (Mac).
2. Open the app and type your server's address in **Server** (for example `mail.example.com`). The server must be reachable over HTTPS.
3. Tap **Sign in**. The app opens your Kurir server's own sign-in page, where you sign in with your passkey as you do in the browser.
4. When the sign-in page hands back to the app, your mail starts syncing.

Sign-in always runs through your own server's login page, so it works with any self-hosted domain and the app never sees your passkey.

### Push notifications

The native apps get pushes through Kurir's push relay (`kurir-notify.arvidson.io`), which forwards notifications to Apple. The server talks to the relay by default; see `PUSH_RELAY_URL` in [Configuration](/docs/configuration). Allow notifications when the app asks, and you get a push when new mail arrives in your Imbox.

### Updates

The native apps update through the App Store. Some app features need a newer server; when that happens the app says so and asks you to [update the server](/docs/updating).

## Progressive Web App

When installed, the PWA runs full-screen without browser chrome, supports push notifications, and survives reboots like a native app would.

### Requirements

- Your Kurir server must be reachable over **HTTPS** with a real (browser-trusted) certificate. The one-command installer handles this automatically with Let's Encrypt. If you self-signed, the install won't work.
- **iOS 16.4 or later** for push notifications. Earlier versions can install the PWA but won't deliver pushes.
- **Web Push enabled** on the server. The installer generates VAPID keys automatically; if you skipped that step, see the [Configuration](/docs/configuration) docs to add them.

### Install on iPhone or iPad

1. Open **Safari** on your phone (it must be Safari — Chrome and Firefox on iOS use WebKit but can't install PWAs).
2. Go to your Kurir URL (e.g. `https://mail.example.com`).
3. Sign in and complete any first-run setup.
4. Tap the **Share** button (the square with the up arrow) at the bottom of the screen.
5. Scroll down in the share sheet and tap **Add to Home Screen**.
6. You'll see a preview with the Kurir icon and name. Tap **Add** in the top right.
7. The Kurir icon now appears on your home screen. Tap it to launch — it opens full-screen, no browser bar.

#### Enable push notifications (iOS 16.4+)

After installing to the home screen, open Kurir from the home screen icon (not Safari). Then:

1. Go to **Settings** inside Kurir
2. Find the **Notifications** section
3. Tap **Enable push notifications**
4. iOS will prompt you for permission — tap **Allow**

You'll now get a push when new mail arrives in your Imbox.

> **Note:** iOS only allows PWAs to request push permission when launched from the home screen. If you try from inside Safari, the option won't appear.

### Install on Android

1. Open **Chrome** (or any Chromium-based browser) on your Android device.
2. Go to your Kurir URL.
3. Sign in and complete any first-run setup.
4. Chrome should show an **Install app** banner near the top or in the menu. If not:
   - Tap the three-dot menu in the top right
   - Tap **Install app** or **Add to Home Screen**
5. Confirm by tapping **Install**.
6. Kurir is now in your app drawer and on your home screen.

#### Enable push notifications (Android)

Push works out of the box on Android. After installing:

1. Open Kurir from your home screen
2. Go to **Settings → Notifications**
3. Tap **Enable push notifications**
4. Allow when prompted

### Updating the installed app

Kurir auto-updates when the server is updated — there's nothing to install on your phone. The PWA fetches the latest assets from your server on each launch (or in the background via the service worker).

If you're seeing stale UI after a server update, force a refresh:

- **iOS:** Close the Kurir tab in the App Switcher, then reopen it from the home screen
- **Android:** Long-press the Kurir icon, tap **App info → Storage → Clear cache**, then relaunch

### Uninstall

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
