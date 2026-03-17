// Push-only service worker — no fetch caching
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || "New message";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    tag: data.tag,
    renotify: true,
    data: { url: data.url || "/imbox" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || "/imbox";
  // Only allow relative paths — prevent open redirect via crafted payloads
  const url = rawUrl.startsWith("/") ? rawUrl : "/imbox";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (new URL(client.url).pathname === url && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
