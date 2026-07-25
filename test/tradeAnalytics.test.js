import { describe, it, expect } from 'vitest'
import { salesAnalytics, quotationStats, purchaseAnalytics, poStats, monthlyTrend } from '../src/utils/tradeAnalytics.js'

describe('sales analytics', () => {
  const invoices = [
    { status: 'paid', date: '2026-03-01', customerName: 'A', total: 1150, amountPaid: 1150, docDiscountAmount: 0, shipping: 0,
      items: [{ description: 'Widget', quantity: 10, unitPrice: 100, subtotal: 900 }] }, // line disc 100
    { status: 'partial', date: '2026-03-05', customerName: 'B', total: 500, amountPaid: 200, docDiscountAmount: 50, shipping: 25,
      items: [{ description: 'Gadget', quantity: 5, unitPrice: 100, subtotal: 500 }] },
    { status: 'void', date: '2026-03-06', customerName: 'A', total: 9999, items: [] }, // excluded
  ]
  const creditNotes = [{ status: 'issued', total: 100 }]

  it('sums sales, returns, discounts and outstanding', () => {
    const s = salesAnalytics(invoices, creditNotes)
    expect(s.grossSales).toBe(1650)         // 1150 + 500 (void excluded)
    expect(s.returns).toBe(100)
    expect(s.netSales).toBe(1550)
    expect(s.lineDiscount).toBe(100)        // 1000 gross − 900 net on line 1
    expect(s.docDiscount).toBe(50)
    expect(s.totalDiscount).toBe(150)
    expect(s.shipping).toBe(25)
    expect(s.count).toBe(2)
    expect(s.outstanding).toBe(300)         // invoice B: 500 − 200
  })

  it('ranks top customers and products', () => {
    const s = salesAnalytics(invoices, creditNotes)
    expect(s.topCustomers[0]).toEqual({ name: 'A', value: 1150 })
    expect(s.topProducts[0].name).toBe('Widget')
    expect(s.topProducts[0].revenue).toBe(900)
  })
})

describe('quotation conversion', () => {
  it('computes conversion rate and open value', () => {
    const q = quotationStats([
      { status: 'invoiced', total: 1000 },
      { status: 'partial', total: 500 },
      { status: 'sent', total: 300 },
      { status: 'accepted', total: 200 },
    ])
    expect(q.total).toBe(4)
    expect(q.converted).toBe(2)
    expect(q.conversionRate).toBe(50)
    expect(q.openValue).toBe(500)  // sent 300 + accepted 200
    expect(q.quotedValue).toBe(2000)
  })
})

describe('purchase analytics + PO stats', () => {
  it('sums purchases, discounts received and payables', () => {
    const p = purchaseAnalytics(
      [{ status: 'received', total: 930, amountPaid: 0, docDiscountAmount: 100, shipping: 30, supplierName: 'X', items: [{ quantity: 1, unitPrice: 1000, subtotal: 1000 }] }],
      [{ status: 'issued', total: 150 }]
    )
    expect(p.grossPurchases).toBe(930)
    expect(p.returns).toBe(150)
    expect(p.discount).toBe(100)      // doc discount (line net == gross here)
    expect(p.freight).toBe(30)
    expect(p.payable).toBe(930)
    expect(p.topSuppliers[0].name).toBe('X')
  })

  it('flags open POs and 3-way-match variances', () => {
    const s = poStats([
      { status: 'partial', total: 1000, items: [{ id: 'a', quantity: 100, receivedQty: 40, billedQty: 40 }] },      // in progress, 60 to receive
      { status: 'sent', total: 500, items: [{ id: 'b', quantity: 10, receivedQty: 12, billedQty: 0 }] },            // over-received → variance
      { status: 'invoiced', total: 800, items: [{ id: 'c', quantity: 5, receivedQty: 5, billedQty: 5 }] },          // matched, closed
    ])
    expect(s.openCount).toBe(2)
    expect(s.openValue).toBe(1500)
    expect(s.variance).toBe(1)
    expect(s.awaitingReceipt).toBe(60)
  })
})

describe('monthly trend', () => {
  it('buckets sales and purchases by month, newest last', () => {
    const t = monthlyTrend(
      [{ status: 'paid', date: '2026-03-01', total: 100 }],
      [{ status: 'received', date: '2026-03-15', total: 40 }],
      3
    )
    expect(t.length).toBe(3)
    const march = t.find((m) => m.month === '2026-03')
    if (march) { expect(march.sales).toBe(100); expect(march.purchases).toBe(40) }
  })
})
