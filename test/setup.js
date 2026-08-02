// Minimal browser globals so the Zustand persist store (and its IndexedDB
// storage, which degrades to localStorage when IndexedDB is absent) can run
// under Node during tests. Each test file gets a fresh module registry, so the
// store singleton and this in-memory localStorage reset between files.
const mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v) },
  removeItem: (k) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
}

// A real (if minimal) event target rather than no-op stubs, so tests that
// care whether a window event actually fired — e.g. the storage-failure
// banner in idbKvStorage.js — can listen for it instead of taking it on
// faith.
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail }
  }
}
const winListeners = new Map()
globalThis.window = globalThis.window || {}
globalThis.window.addEventListener = (type, fn) => {
  if (!winListeners.has(type)) winListeners.set(type, new Set())
  winListeners.get(type).add(fn)
}
globalThis.window.removeEventListener = (type, fn) => { winListeners.get(type)?.delete(fn) }
globalThis.window.dispatchEvent = (event) => {
  winListeners.get(event.type)?.forEach((fn) => fn(event))
  return true
}
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

// Code paths that end in a page reload (restoring a backup or a snapshot) need
// somewhere for that call to land, so a test can run them and then assert on
// what happened *before* the reload — flushing the restored state, in
// particular.
globalThis.window.location = globalThis.window.location || { reload() {}, href: 'http://localhost/' }
