import { describe, it, expect } from 'vitest'
import { lineRemaining, docFulfillment, defaultSelection, buildConversion } from '../src/utils/fulfillment.js'

const KEY = 'invoicedQty'

describe('partial-fulfillment tracking', () => {
  const items = [
    { id: 'a', quantity: 10, unitPrice: 100, discount: 0, taxRate: 15, invoicedQty: 4 }, // 6 remaining
    { id: 'b', quantity: 5, unitPrice: 50, discount: 0, taxRate: 0, invoicedQty: 5 },     // 0 remaining (done)
    { id: 'c', quantity: 3, unitPrice: 20, discount: 0, taxRate: 0 },                     // 3 remaining (untouched)
  ]

  it('computes per-line remaining', () => {
    expect(lineRemaining(items[0], KEY)).toBe(6)
    expect(lineRemaining(items[1], KEY)).toBe(0)
    expect(lineRemaining(items[2], KEY)).toBe(3)
  })

  it('rolls a document up to a partial status', () => {
    const f = docFulfillment(items, KEY)
    expect(f.ordered).toBe(18)
    expect(f.done).toBe(9)        // 4 + 5 + 0
    expect(f.remaining).toBe(9)   // 6 + 0 + 3
    expect(f.status).toBe('partial')
  })

  it('reports open and complete statuses', () => {
    expect(docFulfillment([{ id: 'x', quantity: 5 }], KEY).status).toBe('open')
    expect(docFulfillment([{ id: 'x', quantity: 5, invoicedQty: 5 }], KEY).status).toBe('complete')
  })

  it('defaults the selection to every line’s remaining', () => {
    expect(defaultSelection(items, KEY)).toEqual({ a: 6, c: 3 }) // b is fully done → omitted
  })

  it('builds a conversion clamped to remaining, recomputing money', () => {
    const { items: out, applied, subtotal, taxAmount, total } = buildConversion(items, { a: 100, c: 2 }, { key: KEY })
    // a: wanted 100 but only 6 remain → 6 × 100 = 600, VAT 90
    // c: 2 × 20 = 40, no VAT
    expect(applied).toEqual({ a: 6, c: 2 })
    expect(out.length).toBe(2)
    expect(subtotal).toBe(640)
    expect(taxAmount).toBe(90)
    expect(total).toBe(730)
    expect(out[0].sourceLineId).toBe('a')
  })

  it('honours line discounts when converting', () => {
    const src = [{ id: 'd', quantity: 10, unitPrice: 100, discount: 10, taxRate: 15 }]
    const { subtotal, taxAmount } = buildConversion(src, { d: 10 }, { key: KEY })
    expect(subtotal).toBe(900)   // 1000 − 10%
    expect(taxAmount).toBe(135)  // VAT on net
  })
})
