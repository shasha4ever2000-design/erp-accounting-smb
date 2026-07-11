import { describe, it, expect } from 'vitest'
import { computeLine, documentTotals, invoiceTotals } from '../src/utils/lineMath.js'

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

  it('applies a whole-document discount, reducing VAT pro-rata', () => {
    const items = [{ quantity: 1, unitPrice: 1000, taxRate: 15 }] // net 1000, VAT 150
    const r = invoiceTotals(items, { docDiscountPct: 10 })
    expect(r.netSubtotal).toBe(1000)
    expect(r.docDiscountAmount).toBe(100)   // 10% of 1000
    expect(r.afterDoc).toBe(900)
    expect(r.taxAmount).toBe(135)           // VAT reduced 10% → 150 × 0.9
    expect(r.total).toBe(1035)              // 900 + 135
  })

  it('adds a taxable shipping charge on top', () => {
    const items = [{ quantity: 1, unitPrice: 1000, taxRate: 15 }]
    const r = invoiceTotals(items, { shipping: 50, shippingTaxRate: 15 })
    expect(r.shipping).toBe(50)
    expect(r.shippingVat).toBe(7.5)
    expect(r.taxAmount).toBe(157.5)         // 150 line + 7.5 shipping
    expect(r.total).toBe(1207.5)            // 1000 + 50 + 157.5
  })

  it('combines document discount and shipping correctly', () => {
    const items = [{ quantity: 1, unitPrice: 1000, taxRate: 15 }]
    const r = invoiceTotals(items, { docDiscountPct: 10, shipping: 50, shippingTaxRate: 0 })
    expect(r.afterDoc).toBe(900)
    expect(r.taxAmount).toBe(135)           // only line VAT, discounted; shipping not taxed
    expect(r.total).toBe(1085)              // 900 + 50 + 135
  })
})
