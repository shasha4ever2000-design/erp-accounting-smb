import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()

// The preview a user approves and the run that posts must never disagree —
// they now share one definition of what is due. These tests assert that
// equivalence directly, so a future edit to one path cannot silently drift
// from the other.

const asset = (over = {}) => ({
  name: 'Machine', purchaseDate: '2026-01-01', purchaseCost: 2400,
  salvageValue: 0, usefulLifeYears: 2, depreciationMethod: 'straight_line',
  paymentType: 'credit', ...over,
})

beforeEach(() => useStore.setState({ fixedAssets: [], assetDepreciations: [] }))

describe('preview and run agree', () => {
  it('the preview equals what the run actually posts', () => {
    g().addFixedAsset(asset())
    g().addFixedAsset(asset({ name: 'Van', purchaseCost: 6000, usefulLifeYears: 5 }))

    const preview = g().previewDepreciation('Jan 2026', '2026-01-31')
    const run = g().runDepreciation({ period: 'Jan 2026', date: '2026-01-31' })

    expect(run).toEqual(preview)
  })

  it('the preview goes quiet once the period is posted', () => {
    g().addFixedAsset(asset())
    g().runDepreciation({ period: 'Jan 2026', date: '2026-01-31' })

    expect(g().previewDepreciation('Jan 2026', '2026-01-31')).toEqual({ count: 0, total: 0 })
  })
})

describe('what is due', () => {
  it('charges cost less salvage over the life, in months', () => {
    g().addFixedAsset(asset()) // 2400 over 2 years = 100/month
    const due = g().depreciationDue('Jan 2026', '2026-01-31')
    expect(due).toHaveLength(1)
    expect(due[0].amount).toBeCloseTo(100, 2)
  })

  it('respects salvage value', () => {
    g().addFixedAsset(asset({ purchaseCost: 2400, salvageValue: 400 })) // 2000 / 24
    expect(g().depreciationDue('Jan 2026', '2026-01-31')[0].amount).toBeCloseTo(83.33, 2)
  })

  it('skips an asset not yet acquired at the charge date', () => {
    g().addFixedAsset(asset({ purchaseDate: '2026-06-01' }))
    expect(g().depreciationDue('Jan 2026', '2026-01-31')).toEqual([])
  })

  it('skips a period already charged, so running twice is safe', () => {
    g().addFixedAsset(asset())
    g().runDepreciation({ period: 'Jan 2026', date: '2026-01-31' })
    const second = g().runDepreciation({ period: 'Jan 2026', date: '2026-01-31' })
    expect(second).toEqual({ count: 0, total: 0 })
  })

  it('never depreciates past the salvage value', () => {
    // One month of life left, but a full month's charge would overshoot.
    g().addFixedAsset(asset({ purchaseCost: 1200, usefulLifeYears: 1 })) // 100/month
    useStore.setState({
      fixedAssets: g().fixedAssets.map((a) => ({ ...a, accumulatedDepreciation: 1150 })),
    })
    expect(g().depreciationDue('Dec 2026', '2026-12-31')[0].amount).toBeCloseTo(50, 2)
  })

  it('drops an asset that is already fully depreciated', () => {
    g().addFixedAsset(asset({ purchaseCost: 1200, usefulLifeYears: 1 }))
    useStore.setState({
      fixedAssets: g().fixedAssets.map((a) => ({ ...a, accumulatedDepreciation: 1200 })),
    })
    expect(g().depreciationDue('Dec 2026', '2026-12-31')).toEqual([])
  })

  it('ignores an asset with no useful life rather than dividing by zero', () => {
    g().addFixedAsset(asset({ usefulLifeYears: 0 }))
    const due = g().depreciationDue('Jan 2026', '2026-01-31')
    expect(due).toEqual([])
    expect(g().previewDepreciation('Jan 2026', '2026-01-31').total).toBe(0)
  })

  it('ignores a method the engine cannot compute, rather than guessing', () => {
    g().addFixedAsset(asset({ depreciationMethod: 'declining_balance' }))
    expect(g().depreciationDue('Jan 2026', '2026-01-31')).toEqual([])
  })

  it('ignores a disposed asset', () => {
    g().addFixedAsset(asset())
    useStore.setState({ fixedAssets: g().fixedAssets.map((a) => ({ ...a, status: 'disposed' })) })
    expect(g().depreciationDue('Jan 2026', '2026-01-31')).toEqual([])
  })
})
