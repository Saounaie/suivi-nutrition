// Cache minimal pour l'usage hors ligne. Incrémenter VERSION à chaque déploiement.
const VERSION = 'v9';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/logic.js', 'js/store.js', 'js/seed.js', 'js/off.js', 'js/sync.js', 'js/sound.js', 'js/scanner.js', 'vendor/zxing-library-0.21.3.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (pour recevoir les mises à jour), cache en secours hors ligne.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
