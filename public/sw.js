// Service worker for the installable / offline web edition.
//
// At build time (see offlinePrecache in vite.config.js) the list below is
// filled with every file of the build — every page's code, the fonts, the
// Arabic dictionary, the icons — and VERSION with a hash of that list. Install
// downloads them all, so the whole app works offline from the first visit,
// not only the pages that happened to be opened while online.
//
// A new version installs in the background and then waits. The page shows
// "A new version is ready" and sends SKIP_WAITING when the user says so;
// swapping files under a page that is still running the old ones would break
// the next screen it lazily loads.
const VERSION = 'dev'
const PRECACHE = [/*__PRECACHE__*/]
const CACHE = `erp-cache-${VERSION}`
const BASE = new URL('./', self.location).pathname

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // One file failing (a flaky connection) must not throw away the rest;
    // anything missed is cached on first use instead.
    await Promise.all(PRECACHE.map((path) => cache.add(new URL(path, self.location).href).catch(() => {})))
    await cache.add(BASE).catch(() => {})
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('erp-cache') && k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Pages: network first so an update is picked up, the saved app offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const fresh = await fetch(req)
        if (fresh.ok) cache.put(BASE, fresh.clone())
        return fresh
      } catch {
        return (await cache.match(BASE)) || (await cache.match(req)) || Response.error()
      }
    })())
    return
  }

  // Build files have a hash in their name, so a saved copy is never stale.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req, { ignoreSearch: true })
    if (cached) return cached
    try {
      const fresh = await fetch(req)
      if (fresh && fresh.status === 200 && fresh.type === 'basic') cache.put(req, fresh.clone())
      return fresh
    } catch {
      return Response.error()
    }
  })())
})
