import { describe, it, expect } from 'vitest'
import { priorPeriod, periodDays, variancePct, varianceTone } from '../src/utils/priorPeriod.js'

describe('periodDays', () => {
  it('counts inclusively', () => {
    expect(periodDays('2026-01-01', '2026-01-01')).toBe(1)
    expect(periodDays('2026-01-01', '2026-01-31')).toBe(31)
    expect(periodDays('2026-01-01', '2026-12-31')).toBe(365)
  })
})

describe("priorPeriod — 'previous'", () => {
  it('returns the same-length window immediately before', () => {
    expect(priorPeriod('2026-02-01', '2026-02-28', 'previous')).toEqual({ start: '2026-01-04', end: '2026-01-31' })
  })
  it('ends the day before the current period starts', () => {
    const p = priorPeriod('2026-07-01', '2026-07-31', 'previous')
    expect(p.end).toBe('2026-06-30')
    expect(periodDays(p.start, p.end)).toBe(31)
  })
  it('handles a full year', () => {
    const p = priorPeriod('2026-01-01', '2026-12-31', 'previous')
    expect(p).toEqual({ start: '2025-01-01', end: '2025-12-31' })
  })
  it('handles a single day', () => {
    expect(priorPeriod('2026-03-10', '2026-03-10', 'previous')).toEqual({ start: '2026-03-09', end: '2026-03-09' })
  })
})

describe("priorPeriod — 'lastYear'", () => {
  it('shifts the same calendar window back one year', () => {
    expect(priorPeriod('2026-01-01', '2026-12-31', 'lastYear')).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(priorPeriod('2026-07-01', '2026-07-31', 'lastYear')).toEqual({ start: '2025-07-01', end: '2025-07-31' })
  })
  it('clamps 29 Feb to 28 Feb rather than rolling into March', () => {
    const p = priorPeriod('2028-02-29', '2028-02-29', 'lastYear')
    expect(p.start).toBe('2027-02-28')
    expect(p.end).toBe('2027-02-28')
  })
  it('is unaffected by local timezone (uses UTC)', () => {
    // A naive local-time implementation can shift the boundary a day.
    expect(priorPeriod('2026-01-01', '2026-01-31', 'lastYear').start).toBe('2025-01-01')
  })
})

describe('priorPeriod — hygiene', () => {
  it('passes through missing dates rather than throwing', () => {
    expect(() => priorPeriod('', '', 'previous')).not.toThrow()
    expect(priorPeriod(null, null)).toEqual({ start: null, end: null })
  })
})

describe('variancePct', () => {
  it('computes a normal percentage change', () => {
    expect(variancePct(150, 100)).toBe(50)
    expect(variancePct(50, 100)).toBe(-50)
    expect(variancePct(100, 100)).toBe(0)
  })
  it('uses the magnitude of the prior value, so negatives behave', () => {
    expect(variancePct(-50, -100)).toBe(50)   // loss halved = +50% improvement in magnitude terms
  })
  it('returns null rather than Infinity when growing from zero', () => {
    expect(variancePct(100, 0)).toBeNull()
  })
  it('treats zero-to-zero as flat, not null', () => {
    expect(variancePct(0, 0)).toBe(0)
  })
  it('rounds to one decimal', () => {
    expect(variancePct(1234, 1000)).toBe(23.4)
  })
})

describe('varianceTone — direction means different things per account type', () => {
  it('more revenue is good, less is bad', () => {
    expect(varianceTone(500, 'revenue')).toBe('good')
    expect(varianceTone(-500, 'revenue')).toBe('bad')
  })
  it('more expense is bad, less is good', () => {
    expect(varianceTone(500, 'expense')).toBe('bad')
    expect(varianceTone(-500, 'expense')).toBe('good')
  })
  it('reads a stronger balance sheet as good', () => {
    expect(varianceTone(500, 'asset')).toBe('good')
    expect(varianceTone(500, 'equity')).toBe('good')
    expect(varianceTone(500, 'liability')).toBe('bad')
    expect(varianceTone(-500, 'liability')).toBe('good')
  })
  it('reports no movement as flat', () => {
    expect(varianceTone(0, 'revenue')).toBe('flat')
    expect(varianceTone(0.001, 'expense')).toBe('flat')
  })
})
