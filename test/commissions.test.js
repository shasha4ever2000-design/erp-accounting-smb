import { describe, it, expect } from 'vitest'
import { commissionReport } from '../src/utils/commissions.js'

const reps = [
  { id: 'r1', name: 'Sara', rate: 5 },
  { id: 'r2', name: 'Omar', rate: 10 },
]

const invoices = [
  // Sara: net 1000 (1150 total incl. 150 VAT), fully paid
  { status: 'paid', total: 1150, taxAmount: 150, amountPaid: 1150, salesRepId: 'r1' },
  // Omar: net 2000, half paid
  { status: 'partial', total: 2300, taxAmount: 300, amountPaid: 1150, salesRepId: 'r2' },
  // Unassigned rep → contributes to unassignedBase only
  { status: 'sent', total: 500, taxAmount: 0, amountPaid: 0, salesRepId: '' },
  // Void → excluded entirely
  { status: 'void', total: 9999, taxAmount: 0, amountPaid: 9999, salesRepId: 'r1' },
]

describe('commission report — invoiced basis', () => {
  const r = commissionReport(invoices, reps, { basis: 'invoiced' })
  it('commissions on full net at rep rate', () => {
    const sara = r.rows.find((x) => x.repId === 'r1')
    const omar = r.rows.find((x) => x.repId === 'r2')
    expect(sara.base).toBe(1000)
    expect(sara.commission).toBe(50)      // 1000 * 5%
    expect(omar.base).toBe(2000)
    expect(omar.commission).toBe(200)     // 2000 * 10%
    expect(sara.count).toBe(1)            // void excluded
  })
  it('tracks unassigned base and totals', () => {
    expect(r.unassignedBase).toBe(500)
    expect(r.totalBase).toBe(3000)
    expect(r.totalCommission).toBe(250)
  })
  it('ranks reps by commission descending', () => {
    expect(r.rows[0].repId).toBe('r2')
  })
})

describe('commission report — collected basis', () => {
  const r = commissionReport(invoices, reps, { basis: 'collected' })
  it('commissions only on the collected net fraction', () => {
    const sara = r.rows.find((x) => x.repId === 'r1')
    const omar = r.rows.find((x) => x.repId === 'r2')
    // Sara fully paid → full net 1000
    expect(sara.base).toBe(1000)
    expect(sara.commission).toBe(50)
    // Omar paid 1150/2300 = 50% → net base 1000, commission 100
    expect(omar.base).toBe(1000)
    expect(omar.commission).toBe(100)
  })
  it('unassigned (unpaid) contributes zero collected base', () => {
    expect(r.unassignedBase).toBe(0)   // the 500 invoice has amountPaid 0
    expect(r.totalCommission).toBe(150)
  })
})

describe('edge cases', () => {
  it('handles empty inputs', () => {
    const r = commissionReport([], [], {})
    expect(r.rows).toEqual([])
    expect(r.totalCommission).toBe(0)
    expect(r.unassignedBase).toBe(0)
  })
  it('reps with no invoices show zero, not dropped', () => {
    const r = commissionReport([], reps, { basis: 'invoiced' })
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every((x) => x.commission === 0)).toBe(true)
  })
})
