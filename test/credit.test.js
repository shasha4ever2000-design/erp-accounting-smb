import { describe, it, expect } from 'vitest'
import { invoiceOutstandingBase, customerExposure, creditStatus } from '../src/utils/credit.js'

const invoices = [
  { id: 'i1', customerId: 'c1', total: 1000, amountPaid: 400, status: 'partial' },                 // 600 base
  { id: 'i2', customerId: 'c1', total: 500, amountPaid: 500, status: 'paid' },                      // 0
  { id: 'i3', customerId: 'c1', total: 1000, amountPaid: 0, status: 'void' },                       // excluded
  { id: 'i4', customerId: 'c1', total: 100, amountPaid: 0, status: 'sent', exchangeRate: 1.1 },     // 110 base (FC)
  { id: 'i5', customerId: 'c2', total: 9000, amountPaid: 0, status: 'sent' },                       // other customer
]

describe('customer credit control', () => {
  it('values a single invoice outstanding in base currency', () => {
    expect(invoiceOutstandingBase(invoices[0])).toBe(600)
    expect(invoiceOutstandingBase(invoices[1])).toBe(0)
    expect(invoiceOutstandingBase(invoices[2])).toBe(0)   // void
    expect(invoiceOutstandingBase(invoices[3])).toBeCloseTo(110, 2) // 100 × 1.1
  })

  it('sums exposure for the right customer only, ignoring void/paid', () => {
    expect(customerExposure('c1', invoices)).toBeCloseTo(710, 2)   // 600 + 110
    expect(customerExposure('c2', invoices)).toBe(9000)
    expect(customerExposure('c1', invoices, 'i1')).toBeCloseTo(110, 2) // exclude i1
  })

  it('reports available credit and flags an over-limit customer', () => {
    const s = creditStatus({ id: 'c1', creditLimit: 1000 }, invoices)
    expect(s.exposure).toBeCloseTo(710, 2)
    expect(s.available).toBeCloseTo(290, 2)
    expect(s.over).toBe(false)
  })

  it('predicts a breach for a new invoice that exceeds the limit', () => {
    const s = creditStatus({ id: 'c1', creditLimit: 1000 }, invoices, 500)
    expect(s.projected).toBeCloseTo(1210, 2)
    expect(s.willExceed).toBe(true)
  })

  it('treats no / zero limit as unlimited', () => {
    const s = creditStatus({ id: 'c1', creditLimit: 0 }, invoices, 100000)
    expect(s.hasLimit).toBe(false)
    expect(s.available).toBeNull()
    expect(s.willExceed).toBe(false)
  })
})
