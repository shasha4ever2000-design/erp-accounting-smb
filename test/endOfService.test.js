import { describe, it, expect } from 'vitest'
import {
  defaultEosbSettings, entitlementFactor, awardMonths, eosbAward,
  accruedProvision, accrualFor, accrualSchedule,
  accrualLines, settlementLines, explainAward, EOSB_ACCOUNTS,
} from '../src/utils/endOfService.js'

// 6,000 basic + 1,500 housing = a 7,500 contributory wage.
const contract = (patch = {}) => ({ basic: 6000, housing: 1500, transport: 500, other: 0, startDate: '2020-01-01', ...patch })

const sum = (lines, f) => Math.round(lines.reduce((s, l) => s + l[f], 0) * 100) / 100

describe('awardMonths — Saudi articles 84', () => {
  it('gives half a month a year for the first five years', () => {
    expect(awardMonths(3)).toBe(1.5)
    expect(awardMonths(5)).toBe(2.5)
  })

  it('gives a full month a year after five', () => {
    expect(awardMonths(10)).toBe(7.5)      // 2.5 + 5
    expect(awardMonths(6)).toBe(3.5)
  })

  it('counts a part year pro rata, as article 84 requires', () => {
    expect(awardMonths(2.5)).toBe(1.25)
    expect(awardMonths(5.5)).toBe(3)       // 2.5 + 0.5
  })

  it('gives nothing for no service', () => {
    expect(awardMonths(0)).toBe(0)
    expect(awardMonths(-3)).toBe(0)
  })

  it('does a flat days-per-year scheme instead when asked', () => {
    expect(awardMonths(3, { rule: 'simple', daysPerYear: 30 })).toBe(3)
    expect(awardMonths(3, { rule: 'simple', daysPerYear: 21 })).toBeCloseTo(2.1, 5)
  })

  it('gives nothing at all under the none rule', () => {
    expect(awardMonths(20, { rule: 'none' })).toBe(0)
  })
})

describe('entitlementFactor — article 85, the resignation ladder', () => {
  it('pays nothing for a resignation inside two years', () => {
    expect(entitlementFactor(1.9, 'resignation')).toBe(0)
  })
  it('pays a third from two to five years', () => {
    expect(entitlementFactor(3, 'resignation')).toBeCloseTo(1 / 3, 5)
  })
  it('pays two thirds from five to ten', () => {
    expect(entitlementFactor(7, 'resignation')).toBeCloseTo(2 / 3, 5)
  })
  it('pays the lot at ten years', () => {
    expect(entitlementFactor(10, 'resignation')).toBe(1)
  })
  it('pays the lot however short, when the employer ends it', () => {
    // The scaling punishes leaving, not being let go.
    expect(entitlementFactor(0.5, 'termination')).toBe(1)
    expect(entitlementFactor(1, 'expiry')).toBe(1)
    expect(entitlementFactor(1, 'retirement')).toBe(1)
  })
  it('never scales under a non-Saudi rule', () => {
    expect(entitlementFactor(1, 'resignation', 'simple')).toBe(1)
  })
})

describe('eosbAward', () => {
  it('computes on basic plus housing, not on the whole package', () => {
    const a = eosbAward(contract(), { serviceStart: '2020-01-01', asAt: '2026-01-01', reason: 'termination' })
    expect(a.wage).toBe(7500)
    expect(a.years).toBeCloseTo(6, 1)
    expect(a.months).toBeCloseTo(3.5, 1)
    // 3.5 months × 7,500. Six years measured in days is a hair over six, so
    // the pro-rata part year adds a little — which is the intended behaviour.
    expect(a.award).toBeGreaterThan(26250)
    expect(a.award).toBeLessThan(26350)
  })

  it('computes on gross when the company says so', () => {
    const a = eosbAward(contract(), { serviceStart: '2020-01-01', asAt: '2026-01-01', wageBasis: 'gross' })
    expect(a.wage).toBe(8000)
  })

  it('scales a resignation and reports both figures', () => {
    const a = eosbAward(contract(), { serviceStart: '2023-01-01', asAt: '2026-01-01', reason: 'resignation' })
    expect(a.factor).toBeCloseTo(1 / 3, 5)
    expect(a.award).toBeCloseTo(a.gross / 3, 2)
    expect(a.gross).toBeGreaterThan(a.award)
  })

  it('pays a resignation under two years nothing, while still showing what was forgone', () => {
    const a = eosbAward(contract(), { serviceStart: '2025-06-01', asAt: '2026-01-01', reason: 'resignation' })
    expect(a.award).toBe(0)
    expect(a.gross).toBeGreaterThan(0)
  })

  it('dates service from the service start, not the current contract', () => {
    // A renewal must not wipe out years of accrued benefit.
    const renewed = contract({ startDate: '2025-01-01' })
    const a = eosbAward(renewed, { serviceStart: '2020-01-01', asAt: '2026-01-01' })
    expect(a.years).toBeCloseTo(6, 1)
  })

  it('gives nothing on the none rule', () => {
    expect(eosbAward(contract(), { serviceStart: '2010-01-01', asAt: '2026-01-01', rule: 'none' }).award).toBe(0)
  })
})

describe('the provision', () => {
  it('provides for the full award, never the resignation-discounted one', () => {
    // Providing only the discounted figure leaves the provision short the day
    // somebody is dismissed instead of resigning — which is when it is needed.
    const p = accruedProvision(contract(), { serviceStart: '2023-01-01', asAt: '2026-01-01' })
    const resigned = eosbAward(contract(), { serviceStart: '2023-01-01', asAt: '2026-01-01', reason: 'resignation' })
    expect(p).toBeGreaterThan(resigned.award)
    expect(p).toBe(resigned.gross)
  })

  it('grows every month', () => {
    const a = accruedProvision(contract(), { serviceStart: '2020-01-01', asAt: '2026-01-01' })
    const b = accruedProvision(contract(), { serviceStart: '2020-01-01', asAt: '2026-02-01' })
    expect(b).toBeGreaterThan(a)
  })

  it('is nil on day one', () => {
    expect(accruedProvision(contract(), { serviceStart: '2026-01-01', asAt: '2026-01-01' })).toBe(0)
  })
})

describe('accrualFor — what to post this month', () => {
  it('posts the movement between opening and closing', () => {
    const a = accrualFor(contract(), { serviceStart: '2020-01-01', from: '2026-01-01', to: '2026-02-01' })
    expect(a.periodCharge).toBeGreaterThan(0)
    expect(a.closing).toBeGreaterThan(a.opening)
  })

  it('tops the books up to the right figure when they already hold something', () => {
    const a = accrualFor(contract(), { serviceStart: '2020-01-01', from: '2026-01-01', to: '2026-02-01', alreadyProvided: 1000 })
    expect(a.movement).toBe(Math.round((a.closing - 1000) * 100) / 100)
  })

  it('goes negative when the books hold more than is owed', () => {
    const a = accrualFor(contract(), { serviceStart: '2025-01-01', to: '2026-01-01', alreadyProvided: 999999 })
    expect(a.movement).toBeLessThan(0)
  })

  it('jumps on a pay rise, because the whole award moves to the new wage', () => {
    const before = accruedProvision(contract({ basic: 6000 }), { serviceStart: '2020-01-01', asAt: '2026-01-01' })
    const after = accruedProvision(contract({ basic: 9000 }), { serviceStart: '2020-01-01', asAt: '2026-01-01' })
    expect(after).toBeGreaterThan(before * 1.2)
  })
})

describe('accrualSchedule', () => {
  it('rolls a company up into one charge', () => {
    const rows = [
      { employeeId: 'e1', employeeName: 'Sara', contract: contract(), serviceStart: '2020-01-01', alreadyProvided: 0 },
      { employeeId: 'e2', employeeName: 'Omar', contract: contract({ basic: 4000, housing: 1000 }), serviceStart: '2024-01-01', alreadyProvided: 0 },
    ]
    const s = accrualSchedule(rows, { to: '2026-01-01' })
    expect(s.lines).toHaveLength(2)
    expect(s.total).toBeCloseTo(s.lines[0].movement + s.lines[1].movement, 2)
    expect(s.closing).toBeGreaterThan(0)
  })

  it('handles an empty company', () => {
    expect(accrualSchedule([], { to: '2026-01-01' })).toEqual({ lines: [], total: 0, closing: 0 })
  })
})

describe('accrualLines', () => {
  it('charges expense and builds the provision', () => {
    const l = accrualLines(5000, { reference: 'Jul 2026' })
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.expense).debit).toBe(5000)
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.provision).credit).toBe(5000)
  })

  it('reverses the same two accounts on a negative movement', () => {
    const l = accrualLines(-800)
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.provision).debit).toBe(800)
  })

  it('posts nothing for no movement', () => {
    expect(accrualLines(0)).toEqual([])
  })
})

describe('settlementLines', () => {
  it('releases the provision and pays the award when they agree', () => {
    const l = settlementLines(26250, 26250, { reference: 'Sara' })
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.provision).debit).toBe(26250)
    expect(l.find((x) => x.accountId === 'acc-salpay').credit).toBe(26250)
  })

  it('charges the shortfall to expense when the provision fell short', () => {
    const l = settlementLines(30000, 26250)
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.expense).debit).toBe(3750)
  })

  it('releases the excess back to expense when over-provided', () => {
    // Which is exactly what happens when somebody resigns at three years and
    // takes a third of what was provided for.
    const l = settlementLines(9000, 26250)
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.find((x) => x.accountId === EOSB_ACCOUNTS.expense).credit).toBe(17250)
    expect(l.find((x) => x.accountId === 'acc-salpay').credit).toBe(9000)
  })

  it('still releases the provision when nothing is payable', () => {
    const l = settlementLines(0, 5000)
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'))
    expect(l.some((x) => x.accountId === 'acc-salpay')).toBe(false)
  })

  it('posts nothing when there is nothing on either side', () => {
    expect(settlementLines(0, 0)).toEqual([])
  })
})

describe('explainAward', () => {
  it('says how the figure was reached', () => {
    const a = eosbAward(contract(), { serviceStart: '2020-01-01', asAt: '2026-01-01' })
    expect(explainAward(a)).toMatch(/half a month for the first five years/)
  })
  it('says plainly when a short resignation earns nothing', () => {
    const a = eosbAward(contract(), { serviceStart: '2025-06-01', asAt: '2026-01-01', reason: 'resignation' })
    expect(explainAward(a)).toMatch(/earns nothing/)
  })
  it('says so when no scheme applies', () => {
    expect(explainAward({ rule: 'none' })).toMatch(/No end-of-service/)
  })
})

describe('defaults', () => {
  it('ships switched off, so no company silently gains a liability', () => {
    expect(defaultEosbSettings().rule).toBe('none')
  })
})
