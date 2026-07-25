import { describe, it, expect } from 'vitest'
import { buildSalesTaxReturn } from '../src/utils/salesTaxReturn.js'

const period = { from: '2026-04-01', to: '2026-06-30' }

describe('buildSalesTaxReturn', () => {
  it('separates taxable from exempt/zero-rated sales and totals tax collected', () => {
    const docs = {
      invoices: [
        { date: '2026-05-01', status: 'sent', subtotal: 1000, taxAmount: 80, total: 1080,
          items: [{ subtotal: 1000, taxRate: 8, taxAmount: 80 }] },
        { date: '2026-05-10', status: 'paid', subtotal: 300, taxAmount: 0, total: 300,
          items: [{ subtotal: 300, taxRate: 0, taxCategory: 'exempt' }] },
        // outside period
        { date: '2026-01-01', status: 'paid', subtotal: 9999, taxAmount: 799.92, total: 10798.92,
          items: [{ subtotal: 9999, taxRate: 8 }] },
        // voided
        { date: '2026-05-15', status: 'void', subtotal: 500, taxAmount: 40, total: 540,
          items: [{ subtotal: 500, taxRate: 8 }] },
      ],
      creditNotes: [
        { date: '2026-05-20', status: 'issued', subtotal: 100, taxAmount: 8, total: 108, items: [] },
      ],
    }
    const ret = buildSalesTaxReturn(docs, period)
    expect(ret.taxable).toBe(900) // 1000 - 100 credit note
    expect(ret.exempt).toBe(300)
    expect(ret.totalSales).toBe(1200)
    expect(ret.collected).toBe(72) // 80 - 8
  })

  it('returns zeros for a period with no activity', () => {
    const ret = buildSalesTaxReturn({ invoices: [], creditNotes: [] }, period)
    expect(ret).toEqual({ taxable: 0, exempt: 0, totalSales: 0, collected: 0 })
  })
})
