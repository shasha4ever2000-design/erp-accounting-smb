import { describe, it, expect } from 'vitest'
import { computeLine, documentTotals } from '../src/utils/lineMath.js'

describe('line arithmetic with discounts', () => {
  it('computes a plain line (no discount)', () => {
    const c = computeLine({ quantity: 10, unitPrice: 25, taxRate: 15 })
    expect(c.gross).toBe(250)
    expect(c.discountAmount).toBe(0)
    expect(c.subtotal).toBe(250)
    expect(c.taxAmount).toBe(37.5)
    expect(c.total).toBe(287.5)
  })

  it('applies a percentage discount before tax', () => {
    const c = computeLine({ quantity: 10, unitPrice: 100, discount: 10, taxRate: 15 })
    expect(c.gross).toBe(1000)
    expect(c.discountAmount).toBe(100)
    expect(c.subtotal).toBe(900)       // net of discount
    expect(c.taxAmount).toBe(135)      // VAT on the NET, not the gross
    expect(c.total).toBe(1035)
  })

  it('clamps discount to 0–100 and honours a tax-disabled document', () => {
    expect(computeLine({ quantity: 1, unitPrice: 100, discount: 150 }).subtotal).toBe(0)   // capped at 100%
    expect(computeLine({ quantity: 1, unitPrice: 100, discount: -5 }).subtotal).toBe(100)  // floored at 0
    expect(computeLine({ quantity: 1, unitPrice: 100, taxRate: 15 }, { taxEnabled: false }).taxAmount).toBe(0)
  })

  it('rolls lines up into document totals', () => {
    const items = [
      { quantity: 10, unitPrice: 100, discount: 10, taxRate: 15 }, // net 900, tax 135
      { quantity: 2, unitPrice: 50, taxRate: 0 },                  // net 100, tax 0
    ]
    const t = documentTotals(items)
    expect(t.gross).toBe(1100)
    expect(t.discount).toBe(100)
    expect(t.subtotal).toBe(1000)
    expect(t.taxAmount).toBe(135)
    expect(t.total).toBe(1135)
  })
})
