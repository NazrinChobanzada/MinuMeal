// Food's Up — service worker
// Caches the app shell so the app opens (and mostly works) with no connection.
// Bump CACHE_NAME whenever you want a deploy to force-refresh everyone's cached copy.
const CACHE_NAME = 'foodsup-shell-v1';

const SHELL_FILES = [
  '/app.html',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/foods.js',
  '/manifest.json',
  '/logo-lockup.png',
  '/logo-icon.png',
  '/icon-192.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle our own same-origin GET requests. Everything else (Supabase API
  // calls, Google Fonts, the Supabase JS CDN script) goes straight to the network
  // untouched — we never want to serve a stale API response from cache.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever we already have

      // Cache-first for instant loads; network still runs in the background to
      // keep the cache fresh for next time (stale-while-revalidate).
      return cached || network;
    })
  );
});
