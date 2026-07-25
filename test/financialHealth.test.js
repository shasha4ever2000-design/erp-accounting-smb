import { describe, it, expect } from 'vitest'
import { computeFinancialHealth, healthLabel } from '../src/utils/financialHealth.js'

const find = (res, key) => res.groups.flatMap((g) => g.metrics).find((m) => m.key === key)

describe('financial-health ratios', () => {
  const res = computeFinancialHealth({
    currentAssets: 200000, inventory: 50000, cash: 80000, currentLiabilities: 100000,
    totalAssets: 500000, totalLiabilities: 200000, equity: 300000,
    revenue: 600000, cogs: 360000, grossProfit: 240000, netIncome: 90000,
    ar: 50000, ap: 40000,
  })

  it('computes liquidity ratios', () => {
    expect(find(res, 'current').value).toBeCloseTo(2.0, 3)      // 200k/100k
    expect(find(res, 'quick').value).toBeCloseTo(1.5, 3)        // 150k/100k
    expect(find(res, 'cash').value).toBeCloseTo(0.8, 3)         // 80k/100k
    expect(find(res, 'wc').value).toBeCloseTo(100000, 2)        // 200k−100k
  })

  it('computes profitability ratios', () => {
    expect(find(res, 'gm').value).toBeCloseTo(0.4, 3)           // 240k/600k
    expect(find(res, 'nm').value).toBeCloseTo(0.15, 3)          // 90k/600k
    expect(find(res, 'roe').value).toBeCloseTo(0.3, 3)          // 90k/300k
  })

  it('computes efficiency + leverage ratios', () => {
    expect(find(res, 'dso').value).toBeCloseTo(50000 / 600000 * 365, 2)
    expect(find(res, 'invturn').value).toBeCloseTo(360000 / 50000, 3) // 7.2×
    expect(find(res, 'de').value).toBeCloseTo(200000 / 300000, 3)     // 0.67
    expect(find(res, 'dr').value).toBeCloseTo(0.4, 3)                 // 200k/500k
  })

  it('rates metrics with benchmarks and rolls up a score', () => {
    expect(find(res, 'current').rating).toBe('good')   // 2.0 ≥ 1.5
    expect(find(res, 'dso').rating).toBe('watch')      // ~30.4 days, just over 30
    expect(find(res, 'dpo').rating).toBe('na')         // informational
    expect(res.score).toBeGreaterThan(0)
    expect(res.score).toBeLessThanOrEqual(100)
    expect(res.counts.good + res.counts.watch + res.counts.risk).toBe(res.ratedCount)
  })

  it('guards against divide-by-zero and empty books', () => {
    const empty = computeFinancialHealth({})
    expect(find(empty, 'current').value).toBeNull()
    expect(find(empty, 'current').display).toBe('—')
    expect(empty.score).toBeNull()
    expect(healthLabel(null)).toBe('No data yet')
    expect(healthLabel(80)).toBe('Healthy')
    expect(healthLabel(20)).toBe('At risk')
  })
})
