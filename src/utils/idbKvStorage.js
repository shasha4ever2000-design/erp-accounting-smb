// Async key/value storage backed by IndexedDB, used as the persistence layer
// for the main per-company data store. It lifts the ~5 MB localStorage ceiling
// (a business with many transactions / a logo used to hit it) while migrating
// existing localStorage snapshots transparently on first load. If IndexedDB is
// unavailable it degrades gracefully to localStorage.

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

const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* full */ } }
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
    if (!idbAvailable) return lsSet(name, value)
    try {
      await run('readwrite', (s) => s.put(value, name))
      // Free any old localStorage copy so the 5 MB cap no longer applies.
      lsDel(name)
    } catch (e) {
      console.warn('ERP: IndexedDB write failed, falling back to localStorage.', e)
      lsSet(name, value)
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
