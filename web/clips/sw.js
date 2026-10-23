/* ============ Clips — Service Worker ============
 * Macht Clips installierbar („Zum Home-Bildschirm“) und lädt die App-Dateien
 * auch bei schlechtem Netz. Immer zuerst aus dem Netz (damit Updates sofort
 * ankommen), nur wenn das nicht klappt aus dem Zwischenspeicher. Firebase,
 * Videos und alles von anderen Seiten fasst er nicht an.
 */
'use strict';

const CACHE = 'clips-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      throw e;
    }
  })());
});
