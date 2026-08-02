// IFRS 9 expected credit losses.
//
// The test that matters most is the one about the allowance being a balance
// rather than an expense. Posting the required provision every period instead
// of the movement between periods compounds the allowance until receivables
// are carried at nothing — and every entry balances the whole way down, so
// nothing else in the system would ever object.
import { describe, it, expect } from 'vitest'
import {
  BUCKETS, DEFAULT_MATRIX, bucketFor, ageReceivables, normaliseMatrix,
  computeEcl, customerEcl, eclMovement, provisionLines,
} from '../src/utils/ecl.js'

const AS_OF = '2026-06-30'

const inv = (over = {}) => ({
  id: 'i1', number: 'INV-1', status: 'sent', customerId: 'c1', customerName: 'Acme',
  date: '2026-01-01', dueDate: '2026-06-30', total: 1000, amountPaid: 0, ...over,
})

describe('ageing', () => {
  it('puts each number of days overdue in the right bucket', () => {
    expect(bucketFor(-5)).toBe('current')
    expect(bucketFor(0)).toBe('current')
    expect(bucketFor(1)).toBe('days30')
    expect(bucketFor(30)).toBe('days30')
    expect(bucketFor(31)).toBe('days60')
    expect(bucketFor(90)).toBe('days90')
    expect(bucketFor(91)).toBe('over90')
    expect(bucketFor(9999)).toBe('over90')
  })

  it('ages an open invoice by its due date', () => {
    const aged = ageReceivables([inv({ dueDate: '2026-05-15' })], { asOf: AS_OF })  // 46 days
    expect(aged.totals.days60).toBe(1000)
    expect(aged.grandTotal).toBe(1000)
  })

  it('ages only what is still outstanding', () => {
    const aged = ageReceivables([inv({ status: 'partial', total: 1000, amountPaid: 400 })], { asOf: AS_OF })
    expect(aged.grandTotal).toBe(600)
  })

  it('ignores paid, void and opening-balance invoices', () => {
    const aged = ageReceivables([
      inv({ id: 'a', status: 'paid', amountPaid: 1000 }),
      inv({ id: 'b', status: 'void' }),
      inv({ id: 'c', status: 'sent', isOpening: true }),
    ], { asOf: AS_OF })
    expect(aged.grandTotal).toBe(0)
  })

  it('never lets an overpaid invoice reduce someone else’s exposure', () => {
    // An overpayment is a liability, not a negative receivable. Netting it
    // against another customer's debt would understate the allowance.
    const aged = ageReceivables([
      inv({ id: 'a', customerId: 'c1', total: 1000, amountPaid: 0 }),
      inv({ id: 'b', customerId: 'c2', status: 'partial', total: 500, amountPaid: 900 }),
    ], { asOf: AS_OF })
    expect(aged.grandTotal).toBe(1000)
    expect(aged.customers).toHaveLength(1)
  })

  it('ignores invoices raised after the assessment date', () => {
    const aged = ageReceivables([inv({ date: '2026-08-01' })], { asOf: AS_OF })
    expect(aged.grandTotal).toBe(0)
  })

  it('groups exposure by customer, largest first', () => {
    const aged = ageReceivables([
      inv({ id: 'a', customerId: 'c1', customerName: 'Small', total: 100 }),
      inv({ id: 'b', customerId: 'c2', customerName: 'Big', total: 900 }),
    ], { asOf: AS_OF })
    expect(aged.customers.map((c) => c.customerName)).toEqual(['Big', 'Small'])
  })
})

describe('the provision matrix', () => {
  it('does not assume a not-yet-due receivable is risk-free', () => {
    // A zero rate here is the incurred-loss model IFRS 9 replaced.
    expect(DEFAULT_MATRIX.current).toBeGreaterThan(0)
  })

  it('rises with age', () => {
    const rates = BUCKETS.map((b) => DEFAULT_MATRIX[b.key])
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1])
  })

  it('fills a missing bucket from the default', () => {
    expect(normaliseMatrix({ current: 1 })).toMatchObject({ current: 1, over90: DEFAULT_MATRIX.over90 })
  })

  it('rejects nonsense rates rather than propagating them', () => {
    const m = normaliseMatrix({ current: -5, days30: 'abc', days60: 500 })
    expect(m.current).toBe(DEFAULT_MATRIX.current)
    expect(m.days30).toBe(DEFAULT_MATRIX.days30)
    expect(m.days60).toBe(100)          // capped, not 500
  })

  it('accepts a genuine zero for a bucket the entity has never lost on', () => {
    expect(normaliseMatrix({ current: 0 }).current).toBe(0)
  })
})

describe('computing the allowance', () => {
  const aged = { totals: { current: 10000, days30: 5000, days60: 2000, days90: 1000, over90: 800 } }

  it('applies each bucket rate to its own exposure', () => {
    const { rows, total } = computeEcl(aged, DEFAULT_MATRIX)
    expect(rows.find((r) => r.key === 'current').loss).toBe(50)      // 0.5% of 10,000
    expect(rows.find((r) => r.key === 'over90').loss).toBe(200)      // 25% of 800
    expect(total).toBe(50 + 100 + 100 + 100 + 200)
  })

  it('shows its working — exposure and rate per bucket', () => {
    const { rows } = computeEcl(aged)
    expect(rows[0]).toMatchObject({ key: 'current', exposure: 10000, rate: 0.5 })
  })

  it('is zero on an empty book', () => {
    expect(computeEcl({ totals: {} }).total).toBe(0)
  })

  it('computes a single customer on the same basis', () => {
    const row = { current: 1000, days30: 0, days60: 0, days90: 0, over90: 400 }
    expect(customerEcl(row, DEFAULT_MATRIX)).toBe(105)   // 5 + 100
  })
})

describe('the movement — the part that stops compounding', () => {
  it('charges only the increase when more loss is expected', () => {
    expect(eclMovement(800, 500)).toMatchObject({ required: 800, existing: 500, movement: 300 })
  })

  it('releases the excess when collections improve', () => {
    expect(eclMovement(300, 500).movement).toBe(-200)
  })

  it('posts nothing when the requirement has not changed', () => {
    expect(eclMovement(500, 500).movement).toBe(0)
    expect(provisionLines(0)).toEqual([])
  })

  it('reads an allowance held as a credit balance correctly', () => {
    // The allowance is a contra-asset, so it sits in the ledger as a credit
    // and arrives here negative. Treating that as "nothing provided yet"
    // would double the allowance on the very next assessment.
    expect(eclMovement(800, -500).movement).toBe(300)
  })

  it('does not compound when assessed repeatedly with no change', () => {
    let allowance = 0
    for (let i = 0; i < 12; i++) {
      const { movement } = eclMovement(1000, allowance)
      allowance += movement
    }
    expect(allowance).toBe(1000)   // not 12,000
  })
})

describe('journal lines', () => {
  const sum = (ls, k) => Math.round(ls.reduce((s, l) => s + (l[k] || 0), 0) * 100) / 100

  it('charges expense and builds the allowance when loss increases', () => {
    const lines = provisionLines(300)
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'))
    expect(lines.find((l) => l.accountId === 'acc-baddebt').debit).toBe(300)
    expect(lines.find((l) => l.accountId === 'acc-ecl').credit).toBe(300)
  })

  it('reverses both sides when the allowance is released', () => {
    const lines = provisionLines(-200)
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'))
    expect(lines.find((l) => l.accountId === 'acc-ecl').debit).toBe(200)
    expect(lines.find((l) => l.accountId === 'acc-baddebt').credit).toBe(200)
  })

  it('honours custom account mappings', () => {
    const lines = provisionLines(100, { allowanceAccountId: 'x', expenseAccountId: 'y' })
    expect(lines.map((l) => l.accountId).sort()).toEqual(['x', 'y'])
  })
})

describe('robustness', () => {
  it('survives empty input', () => {
    const aged = ageReceivables([], { asOf: AS_OF })
    expect(aged.grandTotal).toBe(0)
    expect(aged.customers).toEqual([])
    expect(computeEcl(aged).total).toBe(0)
  })

  it('survives an invoice with no due date by ageing from its own date', () => {
    const aged = ageReceivables([inv({ dueDate: undefined, date: '2026-01-01' })], { asOf: AS_OF })
    expect(aged.totals.over90).toBe(1000)
  })

  it('keeps the allowance at two decimals', () => {
    const aged = { totals: { current: 333.33, days30: 0, days60: 0, days90: 0, over90: 0 } }
    expect(computeEcl(aged, { current: 0.5 }).total).toBe(1.67)
  })
})
