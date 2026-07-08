// Service worker for the ERP desktop/offline edition
const CACHE = 'erp-cache-v1'
const BASE = '/erp-accounting-smb/'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // HTML navigations: network-first so updates arrive, fall back to cached shell offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put(BASE, fresh.clone())
        return fresh
      } catch {
        const cache = await caches.open(CACHE)
        return (await cache.match(BASE)) || (await cache.match(req)) || Response.error()
      }
    })())
    return
  }

  // Hashed static assets: cache-first (safe because filenames change per build)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req)
    if (cached) return cached
    try {
      const fresh = await fetch(req)
      if (fresh && fresh.status === 200) cache.put(req, fresh.clone())
      return fresh
    } catch {
      return cached || Response.error()
    }
  })())
})
