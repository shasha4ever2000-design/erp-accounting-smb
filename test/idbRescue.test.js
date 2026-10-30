import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// A tiny IndexedDB stand-in whose writes only commit when the test says so,
// so "the page closed before the background save finished" can be played out.
const disk = new Map()
let holdWrites = false
const held = []
function fakeIDB() {
  const store = {
    put: (value, key) => { const req = {}; req._apply = () => disk.set(key, value); return req },
    get: (key) => { const req = { result: undefined }; req._apply = () => { req.result = disk.get(key) }; return req },
    delete: (key) => { const req = {}; req._apply = () => disk.delete(key); return req },
  }
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const t = { objectStore: () => store }
      const wrap = (fn) => (...args) => {
        const req = fn(...args)
        const commit = () => { req._apply(); t.oncomplete?.() }
        if (holdWrites && fn !== store.get) held.push(commit)
        else setTimeout(commit, 0)
        return req
      }
      t.objectStore = () => ({ put: wrap(store.put), get: wrap(store.get), delete: wrap(store.delete) })
      return t
    },
  }
  return { open: () => { const req = {}; setTimeout(() => { req.result = db; req.onsuccess?.() }, 0); return req } }
}

let kv
beforeAll(() => { globalThis.indexedDB = fakeIDB() })
// A fresh module per test is a fresh page: a page that died mid-save takes its
// unfinished writes with it.
beforeEach(async () => {
  disk.clear(); held.length = 0; holdWrites = false; localStorage.clear()
  vi.resetModules()
  kv = await import('../src/utils/idbKvStorage.js')
})

describe('saving survives the page closing mid-save', () => {
  it('the last change comes back after a reload that beat the database', async () => {
    await kv.idbKvStorage.setItem('erp-co-x', 'v1')
    await kv.flushNow()
    expect(disk.get('erp-co-x')).toBe('v1')

    await kv.idbKvStorage.setItem('erp-co-x', 'v2') // skipped the setup questions
    holdWrites = true                               // the database is slow...
    kv.rescuePending()                              // ...and the page is closing
    await new Promise((r) => setTimeout(r, 5))
    expect(disk.get('erp-co-x')).toBe('v1')         // the write never landed
    held.length = 0                                 // the page is gone; so is the transaction

    holdWrites = false
    vi.resetModules()
    kv = await import('../src/utils/idbKvStorage.js')            // next load
    expect(await kv.idbKvStorage.getItem('erp-co-x')).toBe('v2')
    expect(disk.get('erp-co-x')).toBe('v2')                     // and it was written through
    expect(localStorage.getItem('erp-co-x' + kv.RESCUE_SUFFIX)).toBeNull()
  })

  it('the emergency copy is cleared once the normal save lands', async () => {
    await kv.idbKvStorage.setItem('erp-co-y', 'a')
    await kv.rescuePending()
    expect(disk.get('erp-co-y')).toBe('a')
    expect(localStorage.getItem('erp-co-y' + kv.RESCUE_SUFFIX)).toBeNull()
  })

  it('a newer emergency copy is not removed by an older save finishing', async () => {
    await kv.idbKvStorage.setItem('erp-co-z', 'old')
    holdWrites = true
    kv.rescuePending()
    await new Promise((r) => setTimeout(r, 5))
    await kv.idbKvStorage.setItem('erp-co-z', 'new')
    kv.rescuePending()
    held.splice(0).forEach((c) => c()) // the old write lands now
    await new Promise((r) => setTimeout(r, 5))
    expect(localStorage.getItem('erp-co-z' + kv.RESCUE_SUFFIX)).toBe('new')
  })
})
