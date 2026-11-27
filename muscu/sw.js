// Cache hors ligne de l'appli Muscu (portée : dossier muscu/ uniquement). Incrémenter VERSION à chaque déploiement.
const VERSION = 'muscu-m1';
const FILES = ['./', 'index.html', 'css/muscu.css', 'js/app.js', 'js/logic.js', 'js/store.js', 'js/sync.js', 'js/version.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
// Ne supprime que les anciens caches Muscu : ceux de l'appli nutrition ne sont jamais touchés.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('muscu-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (mises à jour), cache en secours hors ligne.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
