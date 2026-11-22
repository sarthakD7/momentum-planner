// Momentum Planner service worker: makes the app open offline.
// Pages and app files: network first, cached copy when offline.
// Libraries and fonts from CDNs: cached copy first.
// Supabase API traffic is never cached (sync handles offline data itself).
const VERSION = "mp-v29";
const SHELL = ["./", "index.html", "boot.js", "supa-db.js", "notify.js", "ai.js", "mail.js", "bars.js", "look.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

// Reminders sent by the notify server
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Momentum Planner", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Momentum Planner", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: d.url || self.registration.scope },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Always check with the server (a cheap "not modified" reply when nothing changed), so updates
    // show up on the next open instead of after the host's 10-minute browser cache.
    const fresh = req.mode === "navigate"
      ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
      : new Request(req, { cache: "no-cache" });
    e.respondWith(
      fetch(fresh).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(r => r || caches.match("index.html")))
    );
    return;
  }

  if (CDN.test(req.url)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
