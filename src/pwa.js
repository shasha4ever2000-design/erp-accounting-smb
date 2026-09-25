// Installable / offline web edition: registers the service worker (public/sw.js)
// and tells the screens when a new version is waiting and whether we're online.
import { create } from 'zustand'

export const usePwa = create(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  updateReady: false,
  offlineReady: false,
}))

let waiting = null

/** Swap to the new version now (the page reloads once it has taken over). */
export function applyUpdate() {
  if (!waiting) return window.location.reload()
  waiting.postMessage('SKIP_WAITING')
}

export function registerPwa({ url, isDesktop }) {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => usePwa.setState({ online: true }))
  window.addEventListener('offline', () => usePwa.setState({ online: false }))
  if (isDesktop || !('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    let reg
    try { reg = await navigator.serviceWorker.register(url) } catch { return }
    const hadController = !!navigator.serviceWorker.controller

    const watch = (worker) => {
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (worker.state !== 'installed') return
        if (navigator.serviceWorker.controller) { waiting = worker; usePwa.setState({ updateReady: true }) }
        else usePwa.setState({ offlineReady: true }) // first install: everything is saved for offline
      })
    }
    if (reg.waiting && hadController) { waiting = reg.waiting; usePwa.setState({ updateReady: true }) }
    watch(reg.installing)
    reg.addEventListener('updatefound', () => watch(reg.installing))

    // Reload once, when the new version takes over after "Update now".
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return
      reloaded = true
      window.location.reload()
    })

    // A tab left open for days still hears about new versions.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
  })
}
