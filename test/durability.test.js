// How safe are the books?
//
// The verdict this module produces is the one thing standing between a user
// and losing years of accounting to a browser reclaiming disk space. It has
// exactly one job it must never get wrong: it must not tell somebody their
// data is safe when the only copy is inside a browser that is allowed to
// delete it. Most of what follows is about that single failure.
import { describe, it, expect, vi } from 'vitest'
import {
  assessDurability, requestPersistence, isPersisted, storageEstimate,
  daysSince, fmtBytes, AT_RISK, FRAGILE, PROTECTED,
} from '../src/utils/durability.js'

const NOW = new Date('2026-06-30T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

const assess = (over = {}) => assessDurability({ now: NOW, ...over })

describe('the verdict', () => {
  it('is AT RISK when the books have never left the browser', () => {
    // The default state of every new install, and the one that costs a
    // business its accounting records.
    const r = assess({ hasData: true, persisted: true, lastExportAt: '' })
    expect(r.level).toBe(AT_RISK)
    expect(r.offDevice).toBe(false)
    expect(r.reasons.map((x) => x.code)).toContain('NEVER_EXPORTED')
  })

  it('stays AT RISK even with persistent storage granted', () => {
    // Persistence stops automatic eviction. It does not survive clearing site
    // data, a wiped profile, a reinstall, a dead laptop, or a stolen one.
    // Treating it as a substitute for a backup would be the whole point,
    // missed.
    expect(assess({ persisted: true, lastExportAt: '' }).level).toBe(AT_RISK)
  })

  it('is PROTECTED once a recent backup file exists and storage is persistent', () => {
    const r = assess({ persisted: true, lastExportAt: daysAgo(1) })
    expect(r.level).toBe(PROTECTED)
    expect(r.offDevice).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('is PROTECTED when cloud sync is doing the job instead', () => {
    const r = assess({ persisted: true, lastExportAt: '', cloudLinked: true, lastSyncAt: daysAgo(0) })
    expect(r.level).toBe(PROTECTED)
    expect(r.offDevice).toBe(true)
  })

  it('never reports PROTECTED without a copy off the device', () => {
    // The invariant. Whatever combination of local comforts is true, an
    // origin holding the only copy is not protected.
    const combos = [
      { persisted: true, quotaRatio: 0 },
      { persisted: true, quotaRatio: 0.1 },
      { persisted: false, quotaRatio: 0 },
      { persisted: true, cloudLinked: true, lastSyncAt: '' },
    ]
    combos.forEach((c) => expect(assess({ ...c, lastExportAt: '' }).level).not.toBe(PROTECTED))
  })
})

describe('an empty company', () => {
  it('is left alone', () => {
    // Nagging a company with no transactions teaches the user to dismiss this
    // warning before it ever means anything.
    const r = assess({ hasData: false, persisted: false, lastExportAt: '' })
    expect(r.level).toBe(PROTECTED)
    expect(r.empty).toBe(true)
    expect(r.reasons).toEqual([])
  })
})

describe('stale copies', () => {
  it('mentions a backup more than a week old', () => {
    const r = assess({ persisted: true, lastExportAt: daysAgo(10) })
    expect(r.level).toBe(FRAGILE)
    expect(r.reasons.find((x) => x.code === 'EXPORT_STALE')).toMatchObject({ days: 10 })
  })

  it('treats a backup over a month old as serious', () => {
    const r = assess({ persisted: true, lastExportAt: daysAgo(45) })
    expect(r.reasons.find((x) => x.code === 'EXPORT_VERY_STALE')).toBeTruthy()
  })

  it('stops counting a very old export as a copy off the device', () => {
    // A backup from last year is a copy of last year's business, not this
    // one's. Counting it would be worse than counting nothing.
    const r = assess({ persisted: true, lastExportAt: daysAgo(400) })
    expect(r.offDevice).toBe(false)
    expect(r.level).toBe(AT_RISK)
  })

  it('does not count a cloud link that has never synced', () => {
    const r = assess({ persisted: true, lastExportAt: '', cloudLinked: true, lastSyncAt: '' })
    expect(r.offDevice).toBe(false)
    expect(r.reasons.map((x) => x.code)).toContain('CLOUD_NEVER_SYNCED')
  })

  it('notices cloud sync that has stopped running', () => {
    const r = assess({ persisted: true, lastExportAt: '', cloudLinked: true, lastSyncAt: daysAgo(20) })
    expect(r.reasons.find((x) => x.code === 'CLOUD_STALE')).toMatchObject({ days: 20 })
  })
})

describe('local storage conditions', () => {
  it('flags an origin the browser has not agreed to keep', () => {
    const r = assess({ persisted: false, lastExportAt: daysAgo(1) })
    expect(r.reasons.map((x) => x.code)).toContain('NOT_PERSISTED')
    expect(r.level).toBe(FRAGILE)
  })

  it('treats not-persisted as urgent when there is no other copy', () => {
    const r = assess({ persisted: false, lastExportAt: '' })
    expect(r.reasons.find((x) => x.code === 'NOT_PERSISTED').severity).toBe('danger')
  })

  it('softens it to a note when a backup exists', () => {
    const r = assess({ persisted: false, lastExportAt: daysAgo(1) })
    expect(r.reasons.find((x) => x.code === 'NOT_PERSISTED').severity).toBe('info')
  })

  it('distinguishes a browser that cannot from one that would not', () => {
    const r = assess({ persisted: false, persistSupported: false, lastExportAt: daysAgo(1) })
    expect(r.reasons.map((x) => x.code)).toContain('PERSIST_UNSUPPORTED')
  })

  it('warns as the storage allowance fills up', () => {
    expect(assess({ persisted: true, lastExportAt: daysAgo(1), quotaRatio: 0.8 }).reasons.map((x) => x.code)).toContain('QUOTA_HIGH')
    expect(assess({ persisted: true, lastExportAt: daysAgo(1), quotaRatio: 0.95 }).reasons.map((x) => x.code)).toContain('QUOTA_NEARLY_FULL')
  })
})

describe('what the user is told about snapshots', () => {
  it('says outright that they are not a backup', () => {
    // They live in the same IndexedDB as the ledger and die with it. This
    // line is the correction to the single most dangerous assumption a user
    // of this app can make.
    const r = assess({ persisted: true, lastExportAt: '' })
    expect(r.reasons.map((x) => x.code)).toContain('SNAPSHOTS_SHARE_FATE')
  })

  it('does not belabour it once a real backup exists', () => {
    const r = assess({ persisted: true, lastExportAt: daysAgo(1) })
    expect(r.reasons.map((x) => x.code)).not.toContain('SNAPSHOTS_SHARE_FATE')
  })
})

describe('asking the browser for persistent storage', () => {
  const nav = (over) => ({ storage: over })

  it('asks, and reports being granted', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    const r = await requestPersistence(nav({ persisted: async () => false, persist }))
    expect(r).toEqual({ supported: true, persisted: true, alreadyGranted: false })
    expect(persist).toHaveBeenCalledOnce()
  })

  it('does not ask again once granted', async () => {
    const persist = vi.fn()
    const r = await requestPersistence(nav({ persisted: async () => true, persist }))
    expect(r).toEqual({ supported: true, persisted: true, alreadyGranted: true })
    expect(persist).not.toHaveBeenCalled()
  })

  it('treats a refusal as an answer, not a failure', async () => {
    // Chrome declines silently based on engagement signals. That is normal
    // and must not surface as an error.
    const r = await requestPersistence(nav({ persisted: async () => false, persist: async () => false }))
    expect(r).toEqual({ supported: true, persisted: false, alreadyGranted: false })
  })

  it('survives a browser without the Storage API', async () => {
    expect(await requestPersistence({})).toEqual({ supported: false, persisted: false, alreadyGranted: false })
    expect(await requestPersistence(null)).toEqual({ supported: false, persisted: false, alreadyGranted: false })
  })

  it('never throws out of the boot path', async () => {
    // This runs on every start-up. Throwing here would take the app down over
    // a storage permission.
    const hostile = nav({ persisted: () => { throw new Error('nope') }, persist: async () => true })
    await expect(requestPersistence(hostile)).resolves.toMatchObject({ supported: false })
  })
})

describe('reading storage state', () => {
  it('reports the estimate as a ratio', async () => {
    const r = await storageEstimate({ storage: { estimate: async () => ({ usage: 250, quota: 1000 }) } })
    expect(r).toMatchObject({ supported: true, usage: 250, quota: 1000, ratio: 0.25 })
  })

  it('does not divide by a missing quota', async () => {
    const r = await storageEstimate({ storage: { estimate: async () => ({ usage: 10, quota: 0 }) } })
    expect(r.ratio).toBe(0)
  })

  it('degrades quietly where unsupported', async () => {
    expect(await storageEstimate({})).toMatchObject({ supported: false })
    expect(await isPersisted({})).toBe(false)
    expect(await isPersisted({ storage: { persisted: () => { throw new Error('x') } } })).toBe(false)
  })
})

describe('small helpers', () => {
  it('counts whole days', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3)
    expect(daysSince(daysAgo(0), NOW)).toBe(0)
  })

  it('returns null rather than a wrong number for a missing or bad date', () => {
    expect(daysSince('', NOW)).toBeNull()
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })

  it('formats bytes readably', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(fmtBytes(-1)).toBe('0 B')
  })
})
