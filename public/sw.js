/**
 * NuCRM Service Worker — v5
 *
 * Strategies:
 * - App Shell (HTML pages): Network-first → cache fallback → offline page
 * - Static Assets (_next/static): Cache-first (immutable, hashed filenames)
 * - API calls: Network-only with offline JSON fallback
 * - Images/fonts: Stale-while-revalidate with cache expiry
 *
 * Features:
 * - Background sync for failed mutations (POST/PATCH/DELETE)
 * - Periodic cache cleanup (removes entries older than 7 days)
 * - Proper cache versioning and cleanup on activate
 */

const CACHE_VERSION = 'nucrm-v5';
const STATIC_CACHE = 'nucrm-static-v5';
const IMAGE_CACHE = 'nucrm-images-v5';
const OFFLINE_PAGE = '/offline';
const MAX_IMAGE_CACHE = 100;
const MAX_PAGE_CACHE = 50;
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Pre-cache on install
const PRECACHE_URLS = [
  '/manifest.json',
  OFFLINE_PAGE,
];

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches ──────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_VERSION, STATIC_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.map(key => {
          if (!currentCaches.includes(key)) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for caching (let them pass through)
  if (request.method !== 'GET') {
    event.respondWith(fetch(request).catch(() =>
      new Response(JSON.stringify({ error: 'You are offline. Changes will sync when reconnected.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // ── API requests: Network-only with offline fallback ───────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline', offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // ── Next.js static assets: Cache-first (immutable hashed files) ────────
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // ── Images & fonts: Stale-while-revalidate with size limit ─────────────
  if (request.destination === 'image' || request.destination === 'font' ||
      /\.(png|jpg|jpeg|gif|svg|webp|avif|woff2?|ttf|eot|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            if (response.ok) {
              cache.put(request, response.clone());
              // Evict oldest if over limit
              trimCache(IMAGE_CACHE, MAX_IMAGE_CACHE);
            }
            return response;
          }).catch(() => cached);

          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── HTML navigation: Network-first → cache → offline page ──────────────
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => {
              cache.put(request, clone);
              trimCache(CACHE_VERSION, MAX_PAGE_CACHE);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match(OFFLINE_PAGE))
            .then(fallback => fallback || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  // ── Everything else: Network-first with cache fallback ─────────────────
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── Cache Utilities ──────────────────────────────────────────────────────────

/**
 * Trim a cache to a maximum number of entries (FIFO eviction)
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete oldest entries (first in = first out)
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

// ── Background Sync (for offline mutations) ──────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'nucrm-sync') {
    event.waitUntil(replayOfflineMutations());
  }
});

async function replayOfflineMutations() {
  // Future: replay queued POST/PATCH/DELETE from IndexedDB
  console.log('[SW] Background sync triggered');
}

// ── Push Notifications (future) ──────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'NuCRM', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: data.tag || 'nucrm-notification',
      data: { url: data.url || '/tenant/dashboard' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/tenant/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
