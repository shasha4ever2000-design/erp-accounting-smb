// Async key/value storage backed by IndexedDB, used as the persistence layer
// for the main per-company data store. It lifts the ~5 MB localStorage ceiling
// (a business with many transactions / a logo used to hit it) while migrating
// existing localStorage snapshots transparently on first load. If IndexedDB is
// unavailable it degrades gracefully to localStorage.
//
// One failure mode has to be visible rather than silent: IndexedDB unavailable
// *and* localStorage full is the one combination where a write genuinely goes
// nowhere. That used to be swallowed by a bare `catch { /* full */ }` with not
// even a console line.
//
// Layout.jsx already listens for a window `erp-storage-error` event and shows
// a banner for it — a leftover from a `safeStorage` wrapper that dispatched it
// but was never actually passed to `persist()`. This module never fired that
// event, so the banner has been unreachable since the store moved to
// IndexedDB. Dispatching it from here, in the one place a write can actually
// fail today, reconnects it rather than building a second mechanism.

const DB_NAME = 'erp-store'
const STORE = 'kv'
const DB_VERSION = 1

const idbAvailable = typeof indexedDB !== 'undefined' && indexedDB !== null

let dbPromise = null
function getDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch (e) { reject(e); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// Run a transaction and resolve with the inner request's result (for reads).
function run(mode, fn) {
  return getDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

/**
 * Tell the UI a write went nowhere.
 *
 * A no-op wherever `window` or `CustomEvent` is not a real browser global
 * (Node tests, SSR) — this runs inside the write path itself, so raising the
 * banner must never throw and mask the storage failure it is reporting.
 */
function announceFailure() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  if (typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent('erp-storage-error'))
}

const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
/** @returns true if the write landed. */
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true } catch { return false } }
const lsDel = (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } }

export const idbKvStorage = {
  getItem: async (name) => {
    if (!idbAvailable) return lsGet(name)
    try {
      let v = await run('readonly', (s) => s.get(name))
      if (v == null) {
        // One-time migration: pull an existing localStorage snapshot into IDB.
        const legacy = lsGet(name)
        if (legacy != null) { await idbKvStorage.setItem(name, legacy); v = legacy }
      }
      return v == null ? null : v
    } catch (e) {
      console.warn('ERP: IndexedDB read failed, using localStorage.', e)
      return lsGet(name)
    }
  },
  setItem: async (name, value) => {
    if (!idbAvailable) {
      if (!lsSet(name, value)) {
        console.error('ERP: nothing could be saved — IndexedDB is unavailable and localStorage is full.')
        announceFailure()
      }
      return
    }
    try {
      await run('readwrite', (s) => s.put(value, name))
      // Free any old localStorage copy so the 5 MB cap no longer applies.
      lsDel(name)
    } catch (e) {
      console.warn('ERP: IndexedDB write failed, falling back to localStorage.', e)
      if (!lsSet(name, value)) {
        // The one genuinely dangerous case: neither store took the write, so
        // the change the user just made exists only in memory.
        console.error('ERP: nothing could be saved — IndexedDB failed and localStorage is also full.')
        announceFailure()
      }
    }
  },
  removeItem: async (name) => {
    if (idbAvailable) { try { await run('readwrite', (s) => s.delete(name)) } catch { /* ignore */ } }
    lsDel(name)
  },
}

// Delete a company's persisted data from both stores (used when a company is
// removed) so IndexedDB doesn't retain orphaned snapshots.
export function removeCompanyData(companyId) {
  const key = `erp-co-${companyId}`
  lsDel(key)
  if (idbAvailable) run('readwrite', (s) => s.delete(key)).catch(() => {})
}
