/**
 * Hydi ProtoForge — Service Worker
 * Enables offline capability and PWA installability on mobile.
 */

const CACHE = 'hydi-pf-v1';
const PRECACHE = [
  '/hydi-mobile-protoforge.html',
  '/manifest.json',
];

// ── Install: precache shell ──────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ───────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for shell ──
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always go network for API, WS upgrades, and cross-origin
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws/') ||
    url.origin !== self.location.origin
  ) {
    return; // browser default
  }

  // Cache-first for the app shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Fallback to shell for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/hydi-mobile-protoforge.html');
        }
      });
    })
  );
});

// ── Push notifications (future) ──────────────────────────
self.addEventListener('push', (e) => {
  const data = e.data?.json() || { title: 'Hydi', body: 'New ProtoForge event' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'Hydi', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'hydi-event',
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/hydi-mobile-protoforge.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.includes('hydi-mobile-protoforge'));
      if (existing) { existing.focus(); existing.navigate(target); }
      else clients.openWindow(target);
    })
  );
});
