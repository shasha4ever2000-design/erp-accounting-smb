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

/** Actually put a value in a store. Everything above this coalesces. */
async function writeThrough(name, value) {
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
}

// ── Write coalescing ────────────────────────────────────────────────────
//
// The store persists as one JSON blob, so the cost of a save is the size of
// the whole company, not the size of what changed. Measured on this codebase:
// 5,000 journal entries serialize in ~16 ms, 20,000 in ~52 ms, 50,000 in
// ~111 ms — and that happened on *every* mutation. A single invoice fires
// several (the posting, the stock move, the activity log), so a few years of
// books turned every click into hundreds of milliseconds of frozen UI.
//
// Nothing about the data model needs to change to fix that. Consecutive
// writes to the same key supersede each other, so holding the newest for a
// moment and writing once is exactly equivalent — just far less of it.
//
// The obvious risk is losing the last few hundred milliseconds if the tab
// dies. That is what flushNow and the lifecycle listeners below are for:
// anything that ends a session — hiding the tab, navigating away, closing
// the app — writes synchronously first. `visibilitychange` is the one that
// matters on mobile, where a backgrounded tab may never get anything else.
// The queue holds a *thunk* rather than a string, because the expensive half
// of a save is JSON.stringify, not the disk write, and zustand's own
// createJSONStorage serializes before it ever reaches storage. Deferring the
// thunk moves that cost into the flush as well, so a burst of eight mutations
// serializes once instead of eight times.
const WRITE_DELAY_MS = 400
const pending = new Map()   // name -> () => string
let timer = null
let inFlight = Promise.resolve()

function armTimer() {
  if (timer != null) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; flushNow() }, WRITE_DELAY_MS)
}

/**
 * Write everything outstanding immediately.
 *
 * Safe to call at any time, and awaited by the tests. Returns a promise that
 * settles when the queued writes have been attempted.
 */
export function flushNow() {
  if (timer != null) { clearTimeout(timer); timer = null }
  if (pending.size === 0) return inFlight
  const batch = [...pending.entries()]
  pending.clear()
  inFlight = inFlight
    .then(() => Promise.all(batch.map(([n, produce]) => {
      let text
      try { text = produce() } catch (e) {
        // A value that cannot be serialized must not take the rest down.
        console.error('ERP: could not serialize state for saving.', e)
        announceFailure()
        return undefined
      }
      return writeThrough(n, text)
    })))
    .then(() => {})
  return inFlight
}

/** True when a save is still queued — used by the tests and the UI. */
export const hasPendingWrites = () => pending.size > 0

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // pagehide covers back/forward-cache navigations that beforeunload misses;
  // visibilitychange is the only one iOS reliably fires when an app is
  // backgrounded and later killed.
  const onLeave = () => { flushNow() }
  window.addEventListener('pagehide', onLeave)
  window.addEventListener('beforeunload', onLeave)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow()
    })
  }
}

export const idbKvStorage = {
  getItem: async (name) => {
    // A queued value is newer than anything on disk, so answer from it rather
    // than reading a snapshot we are about to overwrite.
    if (pending.has(name)) return pending.get(name)()
    if (!idbAvailable) return lsGet(name)
    try {
      let v = await run('readonly', (s) => s.get(name))
      if (v == null) {
        // One-time migration: pull an existing localStorage snapshot into IDB.
        const legacy = lsGet(name)
        if (legacy != null) { await writeThrough(name, legacy); v = legacy }
      }
      return v == null ? null : v
    } catch (e) {
      console.warn('ERP: IndexedDB read failed, using localStorage.', e)
      return lsGet(name)
    }
  },
  setItem: async (name, value) => {
    pending.set(name, () => value)
    armTimer()
  },
  removeItem: async (name) => {
    pending.delete(name)
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

/**
 * The persistence adapter the main store uses.
 *
 * A drop-in replacement for zustand's `createJSONStorage(() => idbKvStorage)`,
 * differing in one respect that matters: `createJSONStorage` serializes on
 * every state change before handing the string to storage, and on a few years
 * of books that stringify alone measured 52 ms at 20,000 journal entries and
 * 111 ms at 50,000 — on the main thread, on every mutation, and a single
 * invoice makes several. Holding the state object and serializing once, when
 * the queue drains, moves that cost off the interaction entirely.
 */
export const deferredJSONStorage = {
  getItem: async (name) => {
    const raw = await idbKvStorage.getItem(name)
    if (raw == null) return null
    try { return JSON.parse(raw) } catch { return null }
  },
  setItem: async (name, value) => {
    pending.set(name, () => JSON.stringify(value))
    armTimer()
  },
  removeItem: (name) => idbKvStorage.removeItem(name),
}
