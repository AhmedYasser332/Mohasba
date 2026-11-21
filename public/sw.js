const CACHE_PREFIX = 'mohasba-shell-';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/sw-manifest.json', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed loading /sw-manifest.json: ${res.status}`);
      }
      const manifest = await res.json();
      if (!manifest || !manifest.buildId || !Array.isArray(manifest.assets)) {
        throw new Error('Invalid /sw-manifest.json payload');
      }

      const cacheName = `${CACHE_PREFIX}${manifest.buildId}`;
      const cache = await caches.open(cacheName);
      const requests = manifest.assets.map(
        (assetUrl) => new Request(assetUrl, { cache: 'reload' }),
      );
      try {
        await cache.addAll(requests);
      } catch (err) {
        await caches.delete(cacheName);
        throw err;
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      let activeCacheName = null;
      try {
        const res = await fetch('/sw-manifest.json', { cache: 'no-store' });
        if (res.ok) {
          const manifest = await res.json();
          if (manifest && manifest.buildId) {
            activeCacheName = `${CACHE_PREFIX}${manifest.buildId}`;
          }
        }
      } catch {
        // Offline activation: keep newest existing mohasba-shell-* cache if manifest fetch fails
      }

      const keys = await caches.keys();
      const shellKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      const keepKey = activeCacheName || shellKeys[shellKeys.length - 1] || null;

      await Promise.all(
        shellKeys
          .filter((key) => key !== keepKey)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function matchPrecachedAsset(request, options) {
  const keys = await caches.keys();
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const key = keys[i];
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const cache = await caches.open(key);
    const hit = await cache.match(request, options);
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Strictly NetworkOnly for API, SW files, and Next.js RSC payloads
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/sw-manifest.json' ||
    request.headers.get('RSC') === '1' ||
    request.headers.has('RSC') ||
    url.searchParams.has('_rsc')
  ) {
    return;
  }

  // Navigation requests: Network-first falling back to cached '/' (ignoring search query for deep links)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok && !networkResponse.redirected) {
            return networkResponse;
          }
          const cached = await matchPrecachedAsset('/', { ignoreSearch: true });
          return cached || networkResponse;
        } catch {
          const cached = await matchPrecachedAsset('/', { ignoreSearch: true });
          if (cached) return cached;
          return new Response('Offline', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // Precached static assets: CacheFirst
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      (async () => {
        const cached = await matchPrecachedAsset(request);
        if (cached) return cached;
        return fetch(request);
      })(),
    );
  }
});
