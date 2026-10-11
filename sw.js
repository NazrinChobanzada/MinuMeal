// Food's Up — service worker
// Caches the app shell so the app opens (and mostly works) with no connection.
const CACHE_NAME = 'foodsup-shell-v2';

// Anything whose contents change when the app changes. These go network-first:
// serving them from cache meant every deploy arrived a visit late, because you got
// the previous build and the new one only reached the cache for next time.
const CODE = /\.(?:html|js|css|json)$/;

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

const keep = (req, res) => {
  if (res && res.status === 200) {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle our own same-origin GET requests. Everything else (Supabase API
  // calls, Google Fonts, the Supabase JS CDN script) goes straight to the network
  // untouched — we never want to serve a stale API response from cache.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const path = new URL(req.url).pathname;

  // Code: network first, so a deploy takes effect on the very next load. The cache
  // is only the offline fallback. These files are a few hundred KB, so the round
  // trip costs little next to shipping yesterday's build.
  if (req.mode === 'navigate' || CODE.test(path)) {
    event.respondWith(
      fetch(req)
        .then((res) => keep(req, res))
        .catch(async () =>
          (await caches.match(req)) ||
          (req.mode === 'navigate' ? await caches.match('/app.html') : undefined) ||
          Response.error())
    );
    return;
  }

  // Images and the rest: cache first. They are replaced by name, never edited.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => keep(req, res)).catch(() => Response.error()))
  );
});
