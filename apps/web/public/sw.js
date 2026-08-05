/*
 * BrewCult service worker — offline *shell* only.
 *
 * Scope, deliberately narrow (brew_logger_ux §5):
 *   - precache the offline fallback page and the brand/icon assets;
 *   - serve same-origin static assets cache-first, navigations network-first
 *     with a cached fallback, so /brew opens in a kitchen with no signal;
 *   - never touch /api/*. Brew mutations live in the IndexedDB queue
 *     (EF §2.2); two sync engines would eventually disagree, and the one that
 *     loses is the user's brew.
 *
 * Bump CACHE_VERSION on any change here — `activate` deletes every other cache,
 * which is the whole upgrade story.
 */

/* global self, caches, fetch, Request, Response, URL */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `brewcult-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/brew/offline';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/brand/brewcult-lockup-horizontal.svg',
  '/brand/brewcult-lockup-horizontal-reversed.svg',
  '/icons/icon-192.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // One bad URL must not fail the whole install.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname === '/favicon.ico'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never the API

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          return cached || (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});
