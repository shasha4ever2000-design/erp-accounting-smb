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

globalThis.window = globalThis.window || {}
globalThis.window.addEventListener = () => {}
globalThis.window.removeEventListener = () => {}
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
