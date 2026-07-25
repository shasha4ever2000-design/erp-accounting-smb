import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'
import { invoiceTotals } from '../src/utils/lineMath.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('invoice with document discount + shipping', () => {
  g().addCustomer({ name: 'C' }); const cust = last(g().customers)
  // 1 line net 1000 @15% VAT; 10% doc discount; taxable shipping 50
  const items = [{ id: 'L', description: 'Svc', quantity: 1, unitPrice: 1000, discount: 0, taxRate: 15, subtotal: 1000, taxAmount: 150, total: 1150, accountId: 'acc-sales' }]
  const tot = invoiceTotals(items, { docDiscountPct: 10, shipping: 50, shippingTaxRate: 15 })
  const s0 = { sales: bal('acc-sales'), disc: bal('acc-salesdisc'), ship: bal('acc-shipinc'), vat: bal('acc-vatout'), ar: bal('acc-ar') }
  const inv = g().addInvoice({
    customerId: cust.id, customerName: 'C', date: '2026-03-01', dueDate: '2026-04-01',
    items, subtotal: tot.netSubtotal, taxAmount: tot.taxAmount, total: tot.total,
    docDiscount: 10, docDiscountAmount: tot.docDiscountAmount, shipping: tot.shipping,
  })

  it('posts revenue gross, discount to contra, shipping to income, VAT reduced', () => {
    expect(bal('acc-sales') - s0.sales).toBeCloseTo(1000, 2)          // revenue at full line net
    expect(s0.disc - bal('acc-salesdisc')).toBeCloseTo(100, 2)        // 10% discount → contra revenue down
    expect(bal('acc-shipinc') - s0.ship).toBeCloseTo(50, 2)           // shipping income
    expect(bal('acc-vatout') - s0.vat).toBeCloseTo(142.5, 2)          // 135 line (150×0.9) + 7.5 shipping
    expect(bal('acc-ar') - s0.ar).toBeCloseTo(1092.5, 2)             // 1000 −100 +50 +142.5
    expect(inv.total).toBe(1092.5)
    expect(tbDiff()).toBeLessThan(0.01)
  })
})

describe('purchase with document discount + freight', () => {
  g().addSupplier({ name: 'S' }); const supp = last(g().suppliers)
  const items = [{ id: 'P', description: 'Goods', quantity: 1, unitPrice: 1000, discount: 0, taxRate: 0, subtotal: 1000, taxAmount: 0, total: 1000, accountId: 'acc-admin' }]
  const tot = invoiceTotals(items, { docDiscountPct: 10, shipping: 30, shippingTaxRate: 0 })
  const p0 = { ap: bal('acc-ap'), disc: bal('acc-purchdisc'), fr: bal('acc-freightin'), exp: bal('acc-admin') }
  g().addPurchase({
    supplierId: supp.id, supplierName: 'S', date: '2026-03-01', dueDate: '2026-04-01',
    items, subtotal: tot.netSubtotal, taxAmount: tot.taxAmount, total: tot.total,
    docDiscount: 10, docDiscountAmount: tot.docDiscountAmount, shipping: tot.shipping,
  })

  it('posts expense gross, discount to contra, freight to cost, AP net', () => {
    expect(bal('acc-admin') - p0.exp).toBeCloseTo(1000, 2)            // expense at full
    expect(p0.disc - bal('acc-purchdisc')).toBeCloseTo(100, 2)       // purchase discount (contra-expense credit)
    expect(bal('acc-freightin') - p0.fr).toBeCloseTo(30, 2)          // freight-in cost
    expect(bal('acc-ap') - p0.ap).toBeCloseTo(930, 2)               // 1000 −100 +30
    expect(tbDiff()).toBeLessThan(0.01)
  })
})
