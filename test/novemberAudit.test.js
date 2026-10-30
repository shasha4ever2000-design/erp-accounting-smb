// Round 6: end-of-service on the full wage, and GOSI rates by category.
import { describe, it, expect } from 'vitest'
import { eosbAward, eosbWage, defaultEosbSettings } from '../src/utils/endOfService'
import { gosiRates, gosiRatesFor, gosiNeedsCategory, employerCost, emptyContract } from '../src/utils/contracts'

const contract = { basic: 10000, housing: 2500, transport: 1000, other: 500 }

describe('end-of-service wage basis', () => {
  it('defaults new companies to the full wage', () => {
    expect(defaultEosbSettings().wageBasis).toBe('gross')
  })

  it('computes each basis', () => {
    expect(eosbWage(contract, 'gross')).toBe(14000)
    expect(eosbWage(contract, 'contributory')).toBe(12500)
    expect(eosbWage(contract, 'basic')).toBe(10000)
  })

  it('awards on the full wage under the Saudi scheme', () => {
    // About 6 years: 5 × ½ + 1 × 1 ≈ 3.5 months, on the wage chosen.
    const full = eosbAward(contract, { serviceStart: '2020-01-01', asAt: '2026-01-01', wageBasis: 'gross' })
    const narrow = eosbAward(contract, { serviceStart: '2020-01-01', asAt: '2026-01-01', wageBasis: 'contributory' })
    expect(full.wage).toBe(14000)
    expect(narrow.wage).toBe(12500)
    expect(full.months).toBeCloseTo(3.5, 1)
    expect(full.award / narrow.award).toBeCloseTo(14000 / 12500, 4)
  })
})

describe('GOSI rates by category', () => {
  it('Saudis registered before July 2024 pay 9.75% and the employer 11.75%', () => {
    expect(gosiRates('saudi-legacy', '2026-10-01')).toEqual({ employee: 9.75, employer: 11.75 })
  })

  it('Saudis under the new law step up every July', () => {
    expect(gosiRates('saudi-new', '2025-06-30')).toEqual({ employee: 9.75, employer: 11.75 })
    expect(gosiRates('saudi-new', '2025-07-01')).toEqual({ employee: 10.25, employer: 12.25 })
    expect(gosiRates('saudi-new', '2026-06-28')).toEqual({ employee: 10.25, employer: 12.25 })
    expect(gosiRates('saudi-new', '2026-07-28')).toEqual({ employee: 10.75, employer: 12.75 })
    expect(gosiRates('saudi-new', '2028-07-01')).toEqual({ employee: 11.75, employer: 13.75 })
    expect(gosiRates('saudi-new', '2031-01-01')).toEqual({ employee: 11.75, employer: 13.75 })
  })

  it('non-Saudis: employer occupational hazards only', () => {
    expect(gosiRates('non-saudi', '2026-10-01')).toEqual({ employee: 0, employer: 2 })
  })

  it('a record with no category keeps the rates typed on it', () => {
    const old = { gosiApplicable: true, gosiEmployeeRate: 9, gosiEmployerRate: 11 }
    expect(gosiRatesFor(old, '2026-10-01')).toEqual({ employee: 9, employer: 11 })
    expect(gosiNeedsCategory(old)).toBe(true)
    expect(gosiNeedsCategory({ ...old, gosiCategory: 'saudi-legacy' })).toBe(false)
    expect(gosiNeedsCategory({ gosiApplicable: false })).toBe(false)
  })

  it('new contracts start on the Saudi rates, not the old 9 / 11', () => {
    const c = emptyContract({ basic: 8000, housing: 2000, gosiApplicable: true })
    expect(c.gosiCategory).toBe('saudi-legacy')
    expect(employerCost(c, { asAt: '2026-10-01' }).gosiEmployer).toBe(1175)
  })

  it('employer cost follows the date for new-law Saudis', () => {
    const c = emptyContract({ basic: 8000, housing: 2000, gosiApplicable: true, gosiCategory: 'saudi-new' })
    expect(employerCost(c, { asAt: '2025-01-15' }).gosiEmployer).toBe(1175)
    expect(employerCost(c, { asAt: '2026-08-15' }).gosiEmployer).toBe(1275)
  })
})
