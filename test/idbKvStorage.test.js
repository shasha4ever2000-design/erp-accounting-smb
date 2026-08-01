import { describe, it, expect, beforeEach, vi } from 'vitest'
import { idbKvStorage, removeCompanyData, flushNow, hasPendingWrites, deferredJSONStorage } from '../src/utils/idbKvStorage.js'

// The Node test environment (see test/setup.js) has no `indexedDB` global, so
// every write in this file exercises the `!idbAvailable` branch — localStorage
// only. That is also the branch the fix in this file is about: the one
// genuinely dangerous case is neither store taking the write, which used to
// be a bare `catch { /* full */ }` with no signal to the UI at all.

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
})

describe('ordinary reads and writes', () => {
  it('round-trips a value', async () => {
    await idbKvStorage.setItem('k', 'v1')
    expect(await idbKvStorage.getItem('k')).toBe('v1')
  })

  it('returns null for a key that was never set', async () => {
    expect(await idbKvStorage.getItem('missing')).toBeNull()
  })

  it('removes a key', async () => {
    await idbKvStorage.setItem('k', 'v1')
    await idbKvStorage.removeItem('k')
    expect(await idbKvStorage.getItem('k')).toBeNull()
  })
})

describe('the silent-failure fix', () => {
  it('raises erp-storage-error when the write goes nowhere at all', async () => {
    const heard = vi.fn()
    window.addEventListener('erp-storage-error', heard)

    const bad = { getItem: localStorage.getItem, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: localStorage.removeItem }
    const realSet = localStorage.setItem
    localStorage.setItem = bad.setItem
    try {
      await idbKvStorage.setItem('k', 'v1')
      await flushNow()          // writes are coalesced; force it out
    } finally {
      localStorage.setItem = realSet
      window.removeEventListener('erp-storage-error', heard)
    }

    // This is the exact case the report's "silently failed fallback" claim
    // was gesturing at, just for a narrower reason: not that the fallback
    // itself is unsound, but that its own failure went unreported.
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when the write actually lands', async () => {
    const heard = vi.fn()
    window.addEventListener('erp-storage-error', heard)
    await idbKvStorage.setItem('k', 'v1')
    await flushNow()
    window.removeEventListener('erp-storage-error', heard)
    expect(heard).not.toHaveBeenCalled()
  })

  it('never throws out of setItem even when storage is completely gone', async () => {
    // The banner-raising code runs inside the write path itself; it must
    // never itself throw and mask the failure it is trying to report.
    const realSet = localStorage.setItem
    localStorage.setItem = () => { throw new Error('full') }
    try {
      await expect(idbKvStorage.setItem('k', 'v1')).resolves.toBeUndefined()
      await expect(flushNow()).resolves.not.toThrow?.() ?? await flushNow()
    } finally {
      localStorage.setItem = realSet
    }
  })

  it('does not blow up if window.dispatchEvent is not a browser-shaped function', async () => {
    // Guards against a bare TypeError inside the write path in an environment
    // where `window` exists but is not a full browser (some SSR contexts).
    const real = window.dispatchEvent
    window.dispatchEvent = undefined
    const realSet = localStorage.setItem
    localStorage.setItem = () => { throw new Error('full') }
    try {
      await expect(idbKvStorage.setItem('k', 'v1')).resolves.toBeUndefined()
      await flushNow()
    } finally {
      window.dispatchEvent = real
      localStorage.setItem = realSet
    }
  })
})

describe('removeCompanyData', () => {
  it('clears a company key from localStorage', async () => {
    localStorage.setItem('erp-co-abc', '{"x":1}')
    removeCompanyData('abc')
    await flush()
    expect(localStorage.getItem('erp-co-abc')).toBeNull()
  })
})

describe('writes are coalesced', () => {
  // The store persists as one blob, so a save costs the size of the whole
  // company rather than the size of the change. Consecutive writes to the
  // same key supersede each other, so holding the newest briefly and writing
  // once is equivalent — and a single invoice fires several mutations.

  it('does not touch storage until it is flushed', async () => {
    await idbKvStorage.setItem('coalesce', 'first')
    expect(hasPendingWrites()).toBe(true)
    expect(localStorage.getItem('coalesce')).toBeNull()

    await flushNow()
    expect(localStorage.getItem('coalesce')).toBe('first')
    expect(hasPendingWrites()).toBe(false)
  })

  it('writes only the newest of a burst', async () => {
    let writes = 0
    const realSet = localStorage.setItem
    localStorage.setItem = function (k, v) { if (k === 'burst') writes++; return realSet.call(this, k, v) }
    try {
      for (const v of ['a', 'b', 'c', 'd']) await idbKvStorage.setItem('burst', v)
      await flushNow()
    } finally { localStorage.setItem = realSet }

    expect(writes).toBe(1)
    expect(localStorage.getItem('burst')).toBe('d')
  })

  it('reads back the queued value, not the stale one on disk', async () => {
    await idbKvStorage.setItem('k', 'old')
    await flushNow()
    await idbKvStorage.setItem('k', 'new')      // still queued
    expect(await idbKvStorage.getItem('k')).toBe('new')
  })

  it('keeps separate keys separate', async () => {
    await idbKvStorage.setItem('co-a', '1')
    await idbKvStorage.setItem('co-b', '2')
    await flushNow()
    expect(localStorage.getItem('co-a')).toBe('1')
    expect(localStorage.getItem('co-b')).toBe('2')
  })

  it('drops a queued write when the key is removed', async () => {
    await idbKvStorage.setItem('gone', 'x')
    await idbKvStorage.removeItem('gone')
    await flushNow()
    expect(localStorage.getItem('gone')).toBeNull()
  })

  it('flushing with nothing queued is harmless', async () => {
    await expect(flushNow()).resolves.toBeUndefined()
  })
})

describe('deferredJSONStorage — the store adapter', () => {
  // This replaces zustand's createJSONStorage. If it round-trips wrongly the
  // symptom is silent data loss on reload, so it is worth being explicit.

  it('round-trips an object through a flush', async () => {
    const state = { state: { invoices: [{ id: 'i1', total: 100 }] }, version: 35 }
    await deferredJSONStorage.setItem('co', state)
    await flushNow()
    expect(await deferredJSONStorage.getItem('co')).toEqual(state)
  })

  it('serializes once for a burst, not once per mutation', async () => {
    let serialized = 0
    const value = { state: {}, version: 35, get big() { serialized++; return 1 } }
    for (let i = 0; i < 5; i++) await deferredJSONStorage.setItem('burst2', value)
    expect(serialized).toBe(0)          // nothing serialized yet
    await flushNow()
    expect(serialized).toBe(1)          // exactly one
  })

  it('reads back a queued object before it reaches disk', async () => {
    await deferredJSONStorage.setItem('q', { state: { a: 1 }, version: 35 })
    expect(await deferredJSONStorage.getItem('q')).toEqual({ state: { a: 1 }, version: 35 })
  })

  it('returns null for a key that was never written', async () => {
    expect(await deferredJSONStorage.getItem('never')).toBeNull()
  })

  it('returns null rather than throwing on corrupt stored JSON', async () => {
    localStorage.setItem('bad', '{ not json')
    expect(await deferredJSONStorage.getItem('bad')).toBeNull()
  })

  it('survives a value that cannot be serialized, and says so', async () => {
    const heard = vi.fn()
    window.addEventListener('erp-storage-error', heard)
    const cyclic = {}; cyclic.self = cyclic
    await deferredJSONStorage.setItem('cyc', cyclic)
    await expect(flushNow()).resolves.toBeUndefined()
    window.removeEventListener('erp-storage-error', heard)
    expect(heard).toHaveBeenCalled()
  })

  it('removes a key', async () => {
    await deferredJSONStorage.setItem('rm', { state: {}, version: 1 })
    await flushNow()
    await deferredJSONStorage.removeItem('rm')
    expect(await deferredJSONStorage.getItem('rm')).toBeNull()
  })
})
