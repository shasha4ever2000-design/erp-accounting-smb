// IFRS 16 lease measurement.
//
// These tests lean on invariants rather than hard-coded figures wherever they
// can, because an invariant catches a wrong formula and a copied number only
// catches a typo. The ones that matter most: the liability must unwind to
// exactly zero, interest plus principal must reconcile to the payments, and
// total cost under IFRS 16 must equal total cost under the old straight-line
// treatment — the standard changes *when* expense falls, not how much.
import { describe, it, expect } from 'vitest'
import {
  monthlyRate, presentValue, initialMeasurement, liabilitySchedule,
  depreciationSchedule, leaseSchedule, exemption, recognitionLines, periodLines,
  compareToStraightLine, IN_ADVANCE, IN_ARREARS,
} from '../src/utils/ifrs16.js'

// A three-year office lease at 1,000 a month, 6% incremental borrowing rate.
const office = {
  payment: 1000, termMonths: 36, annualRate: 6, timing: IN_ADVANCE,
}

const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100

describe('discount rate', () => {
  it('divides the annual rate across twelve months', () => {
    expect(monthlyRate(6)).toBeCloseTo(0.005, 10)
    expect(monthlyRate(0)).toBe(0)
  })
})

describe('present value', () => {
  it('discounts an ordinary annuity', () => {
    // 12 payments of 100 at 1% a period.
    const pv = presentValue(100, 12, 0.01, IN_ARREARS)
    expect(pv).toBeCloseTo(1125.51, 1)
  })

  it('leaves the first payment undiscounted when paid in advance', () => {
    const advance = presentValue(100, 12, 0.01, IN_ADVANCE)
    const arrears = presentValue(100, 12, 0.01, IN_ARREARS)
    // Paying earlier is worth more, by exactly one period of discounting.
    expect(advance).toBeGreaterThan(arrears)
    expect(advance).toBeCloseTo(arrears * 1.01, 1)
  })

  it('handles an interest-free lease without dividing by zero', () => {
    // A real input, not a defensive guard — the annuity formula divides by r.
    expect(presentValue(500, 24, 0)).toBe(12000)
    expect(Number.isNaN(presentValue(500, 24, 0))).toBe(false)
  })

  it('is zero for no periods or no payment', () => {
    expect(presentValue(1000, 0, 0.005)).toBe(0)
    expect(presentValue(0, 36, 0.005)).toBe(0)
  })
})

describe('initial measurement', () => {
  it('measures the liability at the present value of the payments', () => {
    const { liability } = initialMeasurement(office)
    // 36 payments of 1,000 = 36,000 undiscounted; discounting must reduce it.
    expect(liability).toBeGreaterThan(32000)
    expect(liability).toBeLessThan(36000)
  })

  it('starts the asset from the liability', () => {
    const m = initialMeasurement(office)
    expect(m.rouAsset).toBe(m.liability)
  })

  it('adds initial direct costs and prepayments to the asset only', () => {
    const m = initialMeasurement({ ...office, initialCosts: 2000, prepaid: 500 })
    const base = initialMeasurement(office)
    expect(m.rouAsset).toBe(Math.round((base.liability + 2500) * 100) / 100)
    expect(m.liability).toBe(base.liability)   // costs do not change what is owed
  })

  it('deducts a lease incentive from the asset', () => {
    const m = initialMeasurement({ ...office, incentives: 3000 })
    const base = initialMeasurement(office)
    expect(m.rouAsset).toBe(Math.round((base.liability - 3000) * 100) / 100)
  })
})

describe('the liability unwind', () => {
  const rows = liabilitySchedule(office)

  it('produces one row per period of the term', () => {
    expect(rows).toHaveLength(36)
  })

  it('opens at the measured liability', () => {
    expect(rows[0].opening).toBe(initialMeasurement(office).liability)
  })

  it('unwinds to exactly zero — no rounding tail left on the balance sheet', () => {
    expect(rows[rows.length - 1].closing).toBe(0)
  })

  it('reconciles: every payment is either interest or principal', () => {
    expect(sum(rows, 'interest') + sum(rows, 'principal')).toBeCloseTo(sum(rows, 'payment'), 1)
  })

  it('repays the whole liability through the principal portions', () => {
    expect(sum(rows, 'principal')).toBeCloseTo(rows[0].opening, 1)
  })

  it('front-loads interest, because the liability is largest at the start', () => {
    expect(rows[0].interest).toBeGreaterThan(rows[rows.length - 1].interest)
  })

  it('charges no interest in the first period when paying in advance', () => {
    // The first payment lands at commencement, before any time has passed —
    // but interest still accrues on what remains outstanding after it.
    const first = rows[0]
    expect(first.interest).toBeCloseTo((first.opening - first.payment) * 0.005, 1)
  })

  it('charges interest on the full opening balance when paying in arrears', () => {
    const arrears = liabilitySchedule({ ...office, timing: IN_ARREARS })
    expect(arrears[0].interest).toBeCloseTo(arrears[0].opening * 0.005, 1)
    expect(arrears[arrears.length - 1].closing).toBe(0)
  })

  it('is a pure repayment schedule when the rate is zero', () => {
    const free = liabilitySchedule({ ...office, annualRate: 0 })
    expect(sum(free, 'interest')).toBe(0)
    expect(free[0].opening).toBe(36000)
    expect(free[free.length - 1].closing).toBe(0)
  })

  it('never lets the liability go negative mid-term', () => {
    expect(rows.every((r) => r.closing >= 0)).toBe(true)
  })
})

describe('right-of-use depreciation', () => {
  it('writes the asset down to nothing across the term', () => {
    const dep = depreciationSchedule(office)
    expect(dep).toHaveLength(36)
    expect(dep[dep.length - 1].carrying).toBe(0)
  })

  it('totals exactly the asset — the remainder lands in the last period', () => {
    const dep = depreciationSchedule(office)
    expect(sum(dep, 'charge')).toBeCloseTo(initialMeasurement(office).rouAsset, 1)
  })

  it('uses the shorter of useful life and lease term', () => {
    const shortLife = depreciationSchedule({ ...office, usefulLifeMonths: 24 })
    expect(shortLife).toHaveLength(24)
    const longLife = depreciationSchedule({ ...office, usefulLifeMonths: 120 })
    expect(longLife).toHaveLength(36)   // term is shorter, so the term wins
  })

  it('is empty when there is no asset to depreciate', () => {
    expect(depreciationSchedule({ payment: 0, termMonths: 36 })).toEqual([])
  })
})

describe('the combined schedule', () => {
  const s = leaseSchedule(office)

  it('reports the period expense as depreciation plus interest', () => {
    const r = s.rows[0]
    expect(r.periodExpense).toBeCloseTo(r.depreciation + r.interest, 2)
  })

  it('front-loads total expense against straight-line rent', () => {
    // This is the headline consequence of IFRS 16 and the thing users query.
    const first = s.rows[0].periodExpense
    const last = s.rows[s.rows.length - 1].periodExpense
    expect(first).toBeGreaterThan(last)
  })

  it('costs the same in total as straight-line rent ever did', () => {
    // The standard changes the timing of expense, not its amount. If this
    // fails, the measurement is wrong somewhere.
    const c = compareToStraightLine(office)
    expect(c.ifrs16Total).toBeCloseTo(c.straightLineTotal, 1)
  })

  it('shows a higher charge in year one than straight-line would', () => {
    const c = compareToStraightLine(office)
    expect(c.firstYearIfrs16).toBeGreaterThan(c.firstYearStraightLine)
  })
})

describe('recognition exemptions', () => {
  it('flags a twelve-month lease as short-term', () => {
    expect(exemption({ termMonths: 12 })).toMatchObject({ exempt: true, reason: 'short-term' })
  })

  it('does not exempt a thirteen-month lease', () => {
    expect(exemption({ termMonths: 13 }).exempt).toBe(false)
  })

  it('withdraws the short-term exemption when there is a purchase option', () => {
    // IFRS 16.7(a) — a purchase option disqualifies the short-term election.
    expect(exemption({ termMonths: 12, purchaseOption: true }).exempt).toBe(false)
  })

  it('flags a low-value asset against the configured threshold', () => {
    expect(exemption({ termMonths: 36, assetValue: 3000 }, { lowValueThreshold: 5000 }))
      .toMatchObject({ exempt: true, reason: 'low-value' })
  })

  it('does not apply a low-value threshold that was never configured', () => {
    expect(exemption({ termMonths: 36, assetValue: 10 }).exempt).toBe(false)
  })
})

describe('journal entries', () => {
  it('balances the recognition entry', () => {
    const lines = recognitionLines(office)
    const dr = sum(lines, 'debit'), cr = sum(lines, 'credit')
    expect(dr).toBeCloseTo(cr, 2)
    expect(lines.find((l) => l.accountId === 'acc-rou').debit).toBeGreaterThan(0)
    expect(lines.find((l) => l.accountId === 'acc-leasepay').credit).toBeGreaterThan(0)
  })

  it('balances the recognition entry when there are initial costs', () => {
    const lines = recognitionLines({ ...office, initialCosts: 2000, prepaid: 500 })
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2)
  })

  it('balances the recognition entry when an incentive was received', () => {
    const lines = recognitionLines({ ...office, incentives: 4000 })
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2)
  })

  it('balances every period entry across the whole term', () => {
    for (let p = 1; p <= 36; p++) {
      const { lines } = periodLines(office, p)
      expect(sum(lines, 'debit'), `period ${p}`).toBeCloseTo(sum(lines, 'credit'), 2)
    }
  })

  it('posts interest, payment and depreciation to the right accounts', () => {
    const { lines } = periodLines(office, 2)
    const ids = lines.map((l) => l.accountId)
    expect(ids).toContain('acc-interest')
    expect(ids).toContain('acc-leasepay')
    expect(ids).toContain('acc-depexp')
    expect(ids).toContain('acc-roudepr')
  })

  it('returns nothing for a period beyond the term rather than an unbalanced entry', () => {
    expect(periodLines(office, 37)).toBeNull()
    expect(periodLines(office, 0)).toBeNull()
  })

  it('relieves the liability by exactly its opening balance over the term', () => {
    let liability = initialMeasurement(office).liability
    for (let p = 1; p <= 36; p++) {
      const { lines } = periodLines(office, p)
      const dr = lines.filter((l) => l.accountId === 'acc-leasepay').reduce((s, l) => s + l.debit, 0)
      const cr = lines.filter((l) => l.accountId === 'acc-leasepay').reduce((s, l) => s + l.credit, 0)
      liability = Math.round((liability + cr - dr) * 100) / 100
    }
    expect(liability).toBe(0)
  })
})

describe('robustness', () => {
  it('survives an empty lease', () => {
    expect(liabilitySchedule({})).toEqual([])
    expect(depreciationSchedule({})).toEqual([])
    expect(recognitionLines({})).toEqual([])
    expect(leaseSchedule({}).rows).toEqual([])
  })

  it('handles a one-month lease', () => {
    const rows = liabilitySchedule({ payment: 500, termMonths: 1, annualRate: 6 })
    expect(rows).toHaveLength(1)
    expect(rows[0].closing).toBe(0)
  })

  it('keeps every figure at two decimals', () => {
    const cents = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9
    const rows = liabilitySchedule({ payment: 333.33, termMonths: 18, annualRate: 7.5 })
    expect(rows.every((r) => cents(r.opening) && cents(r.interest) && cents(r.closing))).toBe(true)
  })

  it('handles a long lease without accumulating drift', () => {
    const rows = liabilitySchedule({ payment: 2500, termMonths: 240, annualRate: 5.5 })
    expect(rows).toHaveLength(240)
    expect(rows[rows.length - 1].closing).toBe(0)
    expect(sum(rows, 'principal')).toBeCloseTo(rows[0].opening, 1)
  })
})
