import { describe, it, expect, beforeEach, vi } from 'vitest'
import { idbKvStorage, removeCompanyData } from '../src/utils/idbKvStorage.js'

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
