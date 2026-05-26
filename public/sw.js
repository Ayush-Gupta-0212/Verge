// Verge service worker — caches the app shell so the UI loads instantly on
// repeat visits, renders something when offline, and handles push messages
// + notification-click routing so action buttons work.
//
// IMPORTANT: the `const CACHE = …` line below is rewritten at build time by
// scripts/bump-sw-version.mjs (wired as `prebuild` in package.json). The
// substituted version string is `<package.version>-<git-sha>-<timestamp>`
// so every deploy gets a fresh cache name — old caches are evicted on
// activation, and returning users see the new build immediately.
// Per-environment cache name (host) keeps dev / prod from poisoning each
// other when both are running in the same browser profile.

const CACHE = `verge-shell-${self.location.host}-0.1.0-nogit-1779794164563`;

// Routes that compose the shell. Navigations fall back to '/' if offline.
const SHELL = ['/', '/login'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only — let cross-origin (Supabase, fonts CDN) hit network.
  if (url.origin !== self.location.origin) return;

  // Skip Next.js dev-only paths so HMR isn't poisoned by stale caches.
  if (
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.includes('hot-update') ||
    url.pathname.startsWith('/__nextjs') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Navigations — network-first, fall back to cached shell when offline.
  // /login is treated as network-only (no fallback) so the auth gateway
  // never serves a stale form across deploys; if you're offline you can't
  // sign in anyway.
  if (req.mode === 'navigate') {
    if (url.pathname === '/login' || url.pathname === '/reset-password') {
      event.respondWith(fetch(req));
      return;
    }
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/').then((cached) => cached || caches.match('/login')),
      ),
    );
    return;
  }

  // Static assets — cache-first, populate on miss for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Only cache successful GETs of long-lived assets.
          if (
            res.ok &&
            (url.pathname.startsWith('/_next/static/') ||
              url.pathname.startsWith('/icon') ||
              url.pathname === '/manifest.webmanifest')
          ) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});

// ─── push payloads ───────────────────────────────────────────────────────
// A server (out-of-scope for the client landing) POSTs JSON to the push
// endpoint with this shape:
//   { title, body, tag?, data?: { url?: string, type?: string, taskId?: string },
//     actions?: [{ action: string, title: string }] }
// Empty payloads (some browsers send those as "keepalive" pings) get a
// generic fallback so we never show an empty notification.
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'Verge', body: event.data.text() };
    }
  }
  const title = payload.title || 'Verge';
  const opts = {
    body: payload.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: payload.tag,
    data: payload.data || {},
    actions: payload.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

// ─── notification click router ───────────────────────────────────────────
// Three intents:
//   • action button "snooze:<min>"  → message every open client to snooze
//   • action button "complete"      → message every open client to complete
//   • plain click (no action)       → focus the app (open '/' if not running)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};

  const broadcast = async (message) => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    clientsList.forEach((c) => c.postMessage(message));
    // If no live tab, open one so the message can be replayed on hydrate.
    if (clientsList.length === 0) {
      await self.clients.openWindow(data.url || '/');
      return;
    }
    // Focus the first one so the user sees the result.
    try {
      await clientsList[0].focus();
    } catch {
      // ignore
    }
  };

  if (action && action.startsWith('snooze:')) {
    const minutes = parseInt(action.split(':')[1], 10) || 10;
    event.waitUntil(broadcast({
      type: 'verge:notification-action',
      action: 'snooze',
      minutes,
      taskId: data.taskId,
    }));
    return;
  }
  if (action === 'complete') {
    event.waitUntil(broadcast({
      type: 'verge:notification-action',
      action: 'complete',
      taskId: data.taskId,
    }));
    return;
  }

  // Plain click — focus or open the app at the deep-linked URL.
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const target = clientsList[0];
    if (target) {
      try { await target.focus(); } catch { /* ignore */ }
    } else {
      await self.clients.openWindow(data.url || '/');
    }
  })());
});
