/* Medica Certo service worker: shell cache + Web Push.
 * Never cache /api/* (private). On push: always showNotification on iOS;
 * desktop focused window gets postMessage instead (in-app banner/sound). */
const VERSION = 'mc-shell-v1';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith('/api/')) return;
  e.respondWith(
    (async () => {
      try {
        const res = await fetch(r);
        if (
          res.ok &&
          (r.mode === 'navigate' || SHELL.includes(u.pathname))
        ) {
          const c = await caches.open(VERSION);
          c.put(r.mode === 'navigate' ? '/' : r, res.clone()).catch(() => {});
        }
        return res;
      } catch {
        const c = await caches.open(VERSION);
        return (
          (await c.match(r.mode === 'navigate' ? '/' : r)) ||
          new Response('Sem conexão', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        );
      }
    })(),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = {
      title: 'Medica Certo',
      body: 'Há uma dose para administrar.',
    };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Desktop focused: in-app only. iOS always needs a visible notification.
      if (
        !d.force &&
        !IOS &&
        wins.some((w) => w.visibilityState === 'visible' && w.focused)
      ) {
        wins.forEach((w) =>
          w.postMessage({
            type: 'mc-push',
            kind: d.kind,
            title: d.title,
            body: d.body,
            url: d.url,
          }),
        );
        return;
      }
      // iOS / background: always showNotification (never silent push).
      await self.registration.showNotification(d.title || 'Medica Certo', {
        body: d.body || 'Há uma dose para administrar.',
        tag: d.tag || 'mc-dose',
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        timestamp: d.ts || Date.now(),
        requireInteraction: d.kind === 'dose_alarm',
        data: { url: d.url || '/', kind: d.kind },
      });
      wins.forEach((w) =>
        w.postMessage({
          type: 'mc-push',
          kind: d.kind,
          title: d.title,
          body: d.body,
          url: d.url,
        }),
      );
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(
    (e.notification.data && e.notification.data.url) || '/',
    self.location.origin,
  );
  if (target.origin !== self.location.origin) return;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
      if (w) {
        try {
          await w.focus();
        } catch {
          /* ignore */
        }
        w.postMessage({
          type: 'mc-navigate',
          url: target.pathname + target.search + target.hash,
        });
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const key =
          (e.oldSubscription &&
            e.oldSubscription.options &&
            e.oldSubscription.options.applicationServerKey) ||
          null;
        if (!key) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch {
        /* app re-subscribes on Settings */
      }
    })(),
  );
});
