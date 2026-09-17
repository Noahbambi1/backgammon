// Service worker: network-first with an offline cache, so the app installs as a PWA and keeps
// working with no internet (in-flight "Nearby" mode). Bump CACHE when shipping a new version.
const VERSION = '15'; // bumped by `node bump.js`
const CACHE = 'backgammon-v' + VERSION;
const ASSETS = ['./', './index.html', './css/style.css', './js/config.js', './js/mqtt-lite.js', './js/engine.js', './js/ai.js', './js/net.js', './js/ui.js', './js/app.js',
  './vendor/qrcode.min.js', './vendor/jsQR.min.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    // cache:'no-cache' revalidates against the server (ETag -> cheap 304) instead of trusting the
    // HTTP cache, so a new deploy is picked up on the very next load.
    fetch(new Request(e.request, { cache: 'no-cache' })).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
