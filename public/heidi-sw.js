/**
 * Heidi Mobile service worker (registered with scope /heidi).
 *
 * Caches only the app shell so Heidi opens without a network and can show
 * its saved-on-phone data, clearly labelled as such. It never caches or
 * serves anything under /api/ — status, tasks and chat are always fetched
 * live, so a cached response can never masquerade as current HYDI state.
 */

const CACHE = 'heidi-shell-v1';
const SHELL = ['/heidi', '/heidi.webmanifest', '/heidi-icons/icon-192.png', '/heidi-icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('heidi-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // The /heidi document: network first (so deploys show up), cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/heidi', copy));
          }
          return res;
        })
        .catch(() => caches.match('/heidi'))
    );
    return;
  }

  // Content-hashed Next.js build assets and the shell files: cache first.
  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
