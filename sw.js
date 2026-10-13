/* FlipX service worker — bump CACHE when shell assets change */
const CACHE = 'flipx-v21';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './game.js',
  './board.js',
  './firebase-config.js',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/peerjs.min.js',
  './vendor/qrcode.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isShellScript(url) {
  const p = url.pathname;
  return p.endsWith('.html') || p.endsWith('/') || p.endsWith('.js') || p.endsWith('.webmanifest');
}

function isStaticAsset(url) {
  const p = url.pathname;
  return p.endsWith('.png') || p.includes('/vendor/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  if (isShellScript(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
  }
});
